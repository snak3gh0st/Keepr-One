import { randomUUID } from 'node:crypto'
import type { BrowserAutomationJob, BrowserJobOperation, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_MAX_JOB_ATTEMPTS, NATIONAL_LIFE_PROVIDER } from './constants'
import { assertBrowserJobTransition, type BrowserJobState } from './job-state'
import { redactDiagnostic } from './redaction'

const CASE_SYNC_BUCKET_MS = 5 * 60_000
const LEASE_DURATION_MS = 6 * 60_000
const MAX_IDENTIFIER_LENGTH = 200

const TERMINAL_JOB_STATES: ReadonlySet<BrowserJobState> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
const ACTIVE_JOB_STATES: ReadonlySet<BrowserJobState> = new Set([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_MFA',
  'WAITING_FOR_REVIEW',
  'RETRYABLE',
  'CREDENTIALS_EXPIRED',
  'MANUAL_REVIEW',
])

type PrismaBrowserAutomationJob = BrowserAutomationJob

export type ConnectionTestJobInput = {
  scopeId: string
}

export type CaseReadSyncLookup = {
  kind: 'EXTERNAL_ID'
  value: string
}

export type CaseReadSyncJobInput = {
  caseId: string
  applicationId: string
  lookup: CaseReadSyncLookup
}

export type BrowserJobInput = ConnectionTestJobInput | CaseReadSyncJobInput

export type BrowserJobRecord = {
  id: string
  agentId: string
  caseId: string | null
  provider: string
  operation: BrowserJobOperation
  state: BrowserJobState
  idempotencyKey: string
  input: BrowserJobInput
  result: Prisma.JsonValue | null
  safeErrorCode: string | null
  safeErrorDetail: Prisma.JsonValue | null
  attemptCount: number
  availableAt: Date
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  continuationKeyVersion: string | null
  continuationIv: string | null
  continuationCiphertext: string | null
  continuationAuthTag: string | null
  continuationExpiresAt: Date | null
}

export type ClaimedBrowserJob = BrowserJobRecord

export type CreateBrowserJobInput = {
  agentId: string
  caseId?: string | null
  operation: BrowserJobOperation
  idempotencyKey: string
  input: BrowserJobInput
  state?: BrowserJobState
  attemptCount?: number
  availableAt?: Date
}

export type BrowserJobRepository = {
  findByIdempotencyKey(idempotencyKey: string): Promise<BrowserJobRecord | null>
  findMostRecentByRetryKeyFamily(baseKey: string, states?: readonly BrowserJobState[]): Promise<BrowserJobRecord | null>
  create(input: CreateBrowserJobInput): Promise<BrowserJobRecord>
  claimNextAvailable(input: {
    now: Date
    workerId: string
    leaseExpiresAt: Date
  }): Promise<BrowserJobRecord | null>
  transitionIfState(input: {
    jobId: string
    from: BrowserJobState
    patch: Partial<BrowserJobRecord>
  }): Promise<BrowserJobRecord | null>
  listExpiredRunningJobs(now: Date): Promise<BrowserJobRecord[]>
}

export type BrowserJobServiceDeps = {
  repository?: BrowserJobRepository
  connectionTestScopeId?: string
  now?: () => Date
}

function resolveNow(deps?: BrowserJobServiceDeps): Date {
  return deps?.now?.() ?? new Date()
}

function isTerminalJobState(state: BrowserJobState): boolean {
  return TERMINAL_JOB_STATES.has(state)
}

function coerceIdentifier(name: string, value: string): string {
  const normalized = value.trim()

  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${name} must be between 1 and ${MAX_IDENTIFIER_LENGTH} characters`)
  }

  if (normalized.includes('://')) {
    throw new Error(`${name} must not contain a URL`)
  }

  return normalized
}

function buildCaseSyncBucket(now: Date): number {
  return Math.floor(now.getTime() / CASE_SYNC_BUCKET_MS)
}

function buildCaseSyncIdempotencyKey(agentId: string, caseId: string, now: Date): string {
  return `national-life:case-sync:${agentId}:${caseId}:${buildCaseSyncBucket(now)}`
}

function buildCaseSyncRetryKey(baseKey: string): string {
  return `${baseKey}:retry:${randomUUID()}`
}

function sanitizeCaseReadSyncInput(input: {
  agentId: string
  caseId: string
  applicationId: string
  lookup: { kind: 'EXTERNAL_ID'; value: string }
}): { agentId: string; payload: CaseReadSyncJobInput } {
  const agentId = coerceIdentifier('agentId', input.agentId)
  const caseId = coerceIdentifier('caseId', input.caseId)
  const applicationId = coerceIdentifier('applicationId', input.applicationId)
  const lookupValue = coerceIdentifier('lookup.value', input.lookup.value)

  if (input.lookup.kind !== 'EXTERNAL_ID') {
    throw new Error('lookup.kind must be EXTERNAL_ID')
  }

  return {
    agentId,
    payload: {
      caseId,
      applicationId,
      lookup: {
        kind: 'EXTERNAL_ID',
        value: lookupValue,
      },
    },
  }
}

function sanitizeConnectionTestScopeId(scopeId: string): string {
  return coerceIdentifier('scopeId', scopeId)
}

function buildClaimLeaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_DURATION_MS)
}

function buildLeaseExpiredDetail(job: BrowserJobRecord) {
  return redactDiagnostic({
    leaseOwner: job.leaseOwner,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    attempts: job.attemptCount,
    maxAttempts: NATIONAL_LIFE_MAX_JOB_ATTEMPTS,
  }) as Prisma.JsonValue
}

function buildTransitionPatch(
  input: {
    from: BrowserJobState
    to: BrowserJobState
    result?: unknown
    safeErrorCode?: string
    safeErrorDetail?: unknown
  },
  now: Date,
): Partial<BrowserJobRecord> {
  const patch: Partial<BrowserJobRecord> = {
    state: input.to,
  }

  if (input.result !== undefined) {
    patch.result = input.result as Prisma.JsonValue
  }

  if (input.safeErrorCode !== undefined) {
    patch.safeErrorCode = input.safeErrorCode
  }

  if (input.safeErrorDetail !== undefined) {
    patch.safeErrorDetail = redactDiagnostic(input.safeErrorDetail) as Prisma.JsonValue
  }

  if (input.to === 'RUNNING') {
    patch.startedAt = now
  } else {
    patch.leaseOwner = null
    patch.leaseExpiresAt = null
  }

  if (isTerminalJobState(input.to)) {
    patch.finishedAt = now
  }

  if (input.from === 'WAITING_FOR_MFA' && input.to !== 'WAITING_FOR_MFA') {
    patch.continuationKeyVersion = null
    patch.continuationIv = null
    patch.continuationCiphertext = null
    patch.continuationAuthTag = null
    patch.continuationExpiresAt = null
  }

  return patch
}

function fromPrismaBrowserJob(job: PrismaBrowserAutomationJob): BrowserJobRecord {
  return {
    ...job,
    input: job.input as BrowserJobInput,
  }
}

async function resolveConnectionTestScopeId(deps?: BrowserJobServiceDeps): Promise<string> {
  if (deps?.connectionTestScopeId) {
    return sanitizeConnectionTestScopeId(deps.connectionTestScopeId)
  }

  const { getNationalLifeEnv } = await import('./env')
  return sanitizeConnectionTestScopeId(getNationalLifeEnv().credentialScopeId)
}

const prismaBrowserJobRepository: BrowserJobRepository = {
  async findByIdempotencyKey(idempotencyKey) {
    const job = await prisma.browserAutomationJob.findUnique({
      where: { idempotencyKey },
    })

    return job ? fromPrismaBrowserJob(job) : null
  },

  async findMostRecentByRetryKeyFamily(baseKey, states) {
    const job = await prisma.browserAutomationJob.findFirst({
      where: {
        OR: [
          {
            idempotencyKey: baseKey,
          },
          {
            idempotencyKey: {
              startsWith: `${baseKey}:retry:`,
            },
          },
        ],
        state: states?.length ? { in: [...states] } : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
    })

    return job ? fromPrismaBrowserJob(job) : null
  },

  async create(input) {
    const job = await prisma.browserAutomationJob.create({
      data: {
        agentId: input.agentId,
        caseId: input.caseId ?? null,
        provider: NATIONAL_LIFE_PROVIDER,
        operation: input.operation,
        state: input.state ?? 'QUEUED',
        idempotencyKey: input.idempotencyKey,
        input: input.input as Prisma.InputJsonValue,
        attemptCount: input.attemptCount ?? 0,
        availableAt: input.availableAt ?? new Date(),
      },
    })

    return fromPrismaBrowserJob(job)
  },

  async claimNextAvailable({ now, workerId, leaseExpiresAt }) {
    return prisma.$transaction(async (tx) => {
      const excludedJobIds = new Set<string>()

      while (excludedJobIds.size < 25) {
        const candidate = await tx.browserAutomationJob.findFirst({
          where: {
            state: 'QUEUED',
            availableAt: { lte: now },
            id: excludedJobIds.size ? { notIn: [...excludedJobIds] } : undefined,
            OR: [
              {
                leaseOwner: null,
                leaseExpiresAt: null,
              },
              {
                leaseExpiresAt: { lte: now },
              },
            ],
          },
          orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        })

        if (!candidate) {
          return null
        }

        const claimed = await tx.browserAutomationJob.updateMany({
          where: {
            id: candidate.id,
            state: 'QUEUED',
            availableAt: { lte: now },
            OR: [
              {
                leaseOwner: null,
                leaseExpiresAt: null,
              },
              {
                leaseExpiresAt: { lte: now },
              },
            ],
          },
          data: {
            state: 'RUNNING',
            leaseOwner: workerId,
            leaseExpiresAt,
            startedAt: now,
            attemptCount: {
              increment: 1,
            },
          },
        })

        if (claimed.count === 0) {
          excludedJobIds.add(candidate.id)
          continue
        }

        const job = await tx.browserAutomationJob.findUnique({
          where: { id: candidate.id },
        })

        return job ? fromPrismaBrowserJob(job) : null
      }

      return null
    })
  },

  async transitionIfState({ jobId, from, patch }) {
    const updated = await prisma.browserAutomationJob.updateMany({
      where: {
        id: jobId,
        state: from,
      },
      data: patch as Prisma.BrowserAutomationJobUpdateManyMutationInput,
    })

    if (updated.count === 0) {
      return null
    }

    const job = await prisma.browserAutomationJob.findUnique({
      where: { id: jobId },
    })

    return job ? fromPrismaBrowserJob(job) : null
  },

  async listExpiredRunningJobs(now) {
    const jobs = await prisma.browserAutomationJob.findMany({
      where: {
        state: 'RUNNING',
        leaseExpiresAt: { lte: now },
      },
      orderBy: [{ createdAt: 'asc' }],
    })

    return jobs.map(fromPrismaBrowserJob)
  },
}

function resolveRepository(deps?: BrowserJobServiceDeps): BrowserJobRepository {
  return deps?.repository ?? prismaBrowserJobRepository
}

export function createBrowserJobService(deps?: BrowserJobServiceDeps) {
  const repository = resolveRepository(deps)

  return {
    async enqueueConnectionTest(agentId: string): Promise<{ jobId: string }> {
      const now = resolveNow(deps)
      const safeAgentId = coerceIdentifier('agentId', agentId)
      const scopeId = await resolveConnectionTestScopeId(deps)
      const created = await repository.create({
        agentId: safeAgentId,
        operation: 'TEST_CONNECTION',
        idempotencyKey: `national-life-test-${randomUUID()}`,
        input: {
          scopeId,
        },
        availableAt: now,
      })

      return { jobId: created.id }
    },

    async enqueueCaseReadSync(input: {
      agentId: string
      caseId: string
      applicationId: string
      lookup: { kind: 'EXTERNAL_ID'; value: string }
    }): Promise<{ jobId: string; duplicate: boolean }> {
      const now = resolveNow(deps)
      const sanitized = sanitizeCaseReadSyncInput(input)
      const baseKey = buildCaseSyncIdempotencyKey(sanitized.agentId, sanitized.payload.caseId, now)
      const active = await repository.findMostRecentByRetryKeyFamily(baseKey, [...ACTIVE_JOB_STATES])

      if (active) {
        return { jobId: active.id, duplicate: true }
      }

      const existing = await repository.findMostRecentByRetryKeyFamily(baseKey)

      const created = await repository.create({
        agentId: sanitized.agentId,
        caseId: sanitized.payload.caseId,
        operation: 'SYNC_CASE_READ',
        idempotencyKey: existing ? buildCaseSyncRetryKey(baseKey) : baseKey,
        input: sanitized.payload,
        availableAt: now,
      })

      return { jobId: created.id, duplicate: false }
    },

    async claimNextJob(workerId: string, now = resolveNow(deps)): Promise<ClaimedBrowserJob | null> {
      const safeWorkerId = coerceIdentifier('workerId', workerId)
      return repository.claimNextAvailable({
        now,
        workerId: safeWorkerId,
        leaseExpiresAt: buildClaimLeaseExpiry(now),
      })
    },

    async transitionJob(input: {
      jobId: string
      from: BrowserJobState
      to: BrowserJobState
      result?: unknown
      safeErrorCode?: string
      safeErrorDetail?: unknown
    }): Promise<void> {
      assertBrowserJobTransition(input.from, input.to)
      const now = resolveNow(deps)
      const updated = await repository.transitionIfState({
        jobId: coerceIdentifier('jobId', input.jobId),
        from: input.from,
        patch: buildTransitionPatch(input, now),
      })

      if (!updated) {
        throw new Error(`Browser job ${input.jobId} is no longer in state ${input.from}`)
      }
    },

    async releaseExpiredLeases(now = resolveNow(deps)): Promise<number> {
      const expiredJobs = await repository.listExpiredRunningJobs(now)
      let released = 0

      for (const job of expiredJobs) {
        const safeErrorDetail = buildLeaseExpiredDetail(job)

        if (job.attemptCount < NATIONAL_LIFE_MAX_JOB_ATTEMPTS) {
          const retryable = await repository.transitionIfState({
            jobId: job.id,
            from: 'RUNNING',
            patch: buildTransitionPatch(
              {
                from: 'RUNNING',
                to: 'RETRYABLE',
                safeErrorCode: 'LEASE_EXPIRED',
                safeErrorDetail,
              },
              now,
            ),
          })

          if (!retryable) {
            continue
          }

          const requeued = await repository.transitionIfState({
            jobId: job.id,
            from: 'RETRYABLE',
            patch: {
              ...buildTransitionPatch(
                {
                  from: 'RETRYABLE',
                  to: 'QUEUED',
                },
                now,
              ),
              availableAt: now,
            },
          })

          if (requeued) {
            released += 1
          }
        } else {
          const failed = await repository.transitionIfState({
            jobId: job.id,
            from: 'RUNNING',
            patch: {
              ...buildTransitionPatch(
                {
                  from: 'RUNNING',
                  to: 'FAILED',
                  safeErrorCode: 'LEASE_EXPIRED',
                  safeErrorDetail,
                },
                now,
              ),
              availableAt: now,
            },
          })

          if (failed) {
            released += 1
          }
        }
      }

      return released
    },
  }
}

export async function enqueueConnectionTest(agentId: string): Promise<{ jobId: string }> {
  return createBrowserJobService().enqueueConnectionTest(agentId)
}

export async function enqueueCaseReadSync(input: {
  agentId: string
  caseId: string
  applicationId: string
  lookup: { kind: 'EXTERNAL_ID'; value: string }
}): Promise<{ jobId: string; duplicate: boolean }> {
  return createBrowserJobService().enqueueCaseReadSync(input)
}

export async function claimNextJob(workerId: string, now?: Date): Promise<ClaimedBrowserJob | null> {
  return createBrowserJobService().claimNextJob(workerId, now)
}

export async function transitionJob(input: {
  jobId: string
  from: BrowserJobState
  to: BrowserJobState
  result?: unknown
  safeErrorCode?: string
  safeErrorDetail?: unknown
}): Promise<void> {
  return createBrowserJobService().transitionJob(input)
}

export async function releaseExpiredLeases(now?: Date): Promise<number> {
  return createBrowserJobService().releaseExpiredLeases(now)
}
