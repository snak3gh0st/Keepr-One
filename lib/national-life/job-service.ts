import { createHash, randomUUID } from 'node:crypto'
import type { BrowserAutomationJob, BrowserJobOperation, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_MAX_JOB_ATTEMPTS, NATIONAL_LIFE_PROVIDER } from './constants'
import {
  latestPdfStatusByIllustration,
  type IllustrationPdfStatus,
} from './illustration-pdf-status'
import { assertBrowserJobTransition, type BrowserJobState } from './job-state'
import type { RapidSolveFailure, RapidSolveQuote } from './rapid-solve'
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

/// A pre-sale illustration. Unlike the other two this has no case: the insured
/// is a prospect who exists only on the screen the agent is filling in, which is
/// why `BrowserAutomationJob.caseId` stays null for it.
///
/// Dates cross the queue as `MM/DD/YYYY` strings rather than `Date`, because the
/// row is JSON and a `Date` would come back from Postgres as whatever the parser
/// made of it. This is already the carrier's own format.
export type RapidSolveQuoteJobInput = {
  issueState: string
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: string
  rateClass: string
  solveType: string
  amount: number
  deathBenefitOption: string
  strategy: string
  allocation: number
  productCode: string
  /// Set when the agent quoted for someone already in the system. A prospect
  /// has none, which is the ordinary case for a pre-sale illustration.
  clientId?: string
}

/// Asks the carrier to render an illustration it already holds as a case.
///
/// Carries the illustration row rather than the carrier's case name because the
/// row is what the document has to end up on; the case name is how Foresight
/// finds it, and a quick quote is named RP-<surname>-QQ-<stamp> on their side.
export type IllustrationPdfJobInput = {
  illustrationId: string
  caseNameFragment?: string
}

export type BrowserJobInput =
  | ConnectionTestJobInput
  | CaseReadSyncJobInput
  | RapidSolveQuoteJobInput
  | IllustrationPdfJobInput

/// Three outcomes the screen has to tell apart, and it must not collapse them.
/// ANSWERED means the carrier replied — including a reply that refuses to
/// quote, which carries its own sentence. UNAVAILABLE means we never got an
/// answer, and showing a number there would be inventing one.
export type RapidSolveQuoteStatus =
  | { state: 'PENDING' }
  | { state: 'ANSWERED'; quote: RapidSolveQuote | RapidSolveFailure }
  | { state: 'UNAVAILABLE'; safeErrorCode: string }

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
  findOwnedById(agentId: string, jobId: string): Promise<BrowserJobRecord | null>
  /// Newest first. One query for a whole screen, rather than one per row.
  listRecentByOperation(input: {
    agentId: string
    operation: BrowserJobOperation
    limit: number
  }): Promise<BrowserJobRecord[]>
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

/// Keyed by the input rather than by the subject, which the case-sync key cannot
/// be: two quotes for the same prospect minutes apart are the normal way an
/// agent works — raise the face amount, ask again. Bucketing on agent and
/// prospect alone would hand back the first quote's numbers under the second
/// quote's question, and it would look like an answer.
///
/// The bucket still absorbs a double-click, because an identical input inside
/// the window is the same question.
function buildRapidSolveIdempotencyKey(
  agentId: string,
  payload: RapidSolveQuoteJobInput,
  now: Date,
): string {
  const canonical = JSON.stringify([
    payload.issueState,
    payload.firstName,
    payload.lastName,
    payload.dateOfBirth,
    payload.gender,
    payload.rateClass,
    payload.solveType,
    payload.amount,
    payload.deathBenefitOption,
    payload.strategy,
    payload.allocation,
    payload.productCode,
  ])
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32)
  return `national-life:rapid-solve:${agentId}:${digest}:${buildCaseSyncBucket(now)}`
}

function sanitizeRapidSolveQuoteInput(input: {
  agentId: string
  quote: RapidSolveQuoteJobInput
}): { agentId: string; payload: RapidSolveQuoteJobInput } {
  const agentId = coerceIdentifier('agentId', input.agentId)
  const quote = input.quote

  const amount = Number(quote.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number')
  }

  const allocation = Number(quote.allocation)
  if (!Number.isFinite(allocation) || allocation < 0 || allocation > 100) {
    throw new Error('allocation must be between 0 and 100')
  }

  // MM/DD/YYYY is what the carrier's date picker submits and what
  // `toCarrierDate` produces, so anything else means a caller built the payload
  // by hand and got it wrong. Catching it here beats a carrier refusal.
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(quote.dateOfBirth)) {
    throw new Error('dateOfBirth must be MM/DD/YYYY')
  }

  return {
    agentId,
    payload: {
      issueState: coerceIdentifier('issueState', quote.issueState),
      firstName: coerceIdentifier('firstName', quote.firstName),
      lastName: coerceIdentifier('lastName', quote.lastName),
      dateOfBirth: quote.dateOfBirth,
      gender: coerceIdentifier('gender', quote.gender),
      rateClass: coerceIdentifier('rateClass', quote.rateClass),
      solveType: coerceIdentifier('solveType', quote.solveType),
      amount,
      deathBenefitOption: coerceIdentifier('deathBenefitOption', quote.deathBenefitOption),
      strategy: coerceIdentifier('strategy', quote.strategy),
      allocation: Math.trunc(allocation),
      productCode: coerceIdentifier('productCode', quote.productCode),
      ...(quote.clientId
        ? { clientId: coerceIdentifier('clientId', quote.clientId) }
        : {}),
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
  return sanitizeConnectionTestScopeId(getNationalLifeEnv().sessionScopeId)
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

  async findOwnedById(agentId, jobId) {
    // The agent is part of the lookup rather than checked after it, so a job id
    // belonging to someone else is indistinguishable from one that does not
    // exist. A quote carries a named insured and a premium.
    const job = await prisma.browserAutomationJob.findFirst({
      where: { id: jobId, agentId },
    })

    return job ? fromPrismaBrowserJob(job) : null
  },

  async listRecentByOperation({ agentId, operation, limit }) {
    // Scoped by agent in the query, same reason as `findOwnedById`.
    const jobs = await prisma.browserAutomationJob.findMany({
      where: { agentId, operation },
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
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

    async enqueueRapidSolveQuote(input: {
      agentId: string
      quote: RapidSolveQuoteJobInput
    }): Promise<{ jobId: string; duplicate: boolean }> {
      const now = resolveNow(deps)
      const sanitized = sanitizeRapidSolveQuoteInput(input)
      const baseKey = buildRapidSolveIdempotencyKey(sanitized.agentId, sanitized.payload, now)
      const active = await repository.findMostRecentByRetryKeyFamily(baseKey, [...ACTIVE_JOB_STATES])

      if (active) {
        return { jobId: active.id, duplicate: true }
      }

      const existing = await repository.findMostRecentByRetryKeyFamily(baseKey)

      const created = await repository.create({
        agentId: sanitized.agentId,
        // A prospect has no case. The column is nullable for exactly this.
        operation: 'GET_RAPID_SOLVE_QUOTE',
        idempotencyKey: existing ? buildCaseSyncRetryKey(baseKey) : baseKey,
        input: sanitized.payload,
        availableAt: now,
      })

      return { jobId: created.id, duplicate: false }
    },

    /// Asks the carrier to render an illustration it already holds.
    ///
    /// Keyed on the illustration alone, unlike a quote: re-rendering the same
    /// illustration is the same request no matter how often it is clicked, and
    /// there is no payload that could change its meaning. Rendering twice would
    /// cost a carrier browser and hand back the same document.
    async enqueueIllustrationPdf(input: {
      agentId: string
      illustrationId: string
      caseNameFragment?: string
    }): Promise<{ jobId: string; duplicate: boolean }> {
      const agentId = coerceIdentifier('agentId', input.agentId)
      const illustrationId = coerceIdentifier('illustrationId', input.illustrationId)
      const now = resolveNow(deps)
      const baseKey = `national-life:illustration-pdf:${agentId}:${illustrationId}`

      const active = await repository.findMostRecentByRetryKeyFamily(baseKey, [
        ...ACTIVE_JOB_STATES,
      ])
      if (active) {
        return { jobId: active.id, duplicate: true }
      }

      const existing = await repository.findMostRecentByRetryKeyFamily(baseKey)
      const created = await repository.create({
        agentId,
        operation: 'GENERATE_ILLUSTRATION_PDF',
        idempotencyKey: existing ? buildCaseSyncRetryKey(baseKey) : baseKey,
        input: {
          illustrationId,
          ...(input.caseNameFragment ? { caseNameFragment: input.caseNameFragment } : {}),
        },
        availableAt: now,
      })

      return { jobId: created.id, duplicate: false }
    },

    /// Where each pending or failed render stands, keyed by illustration.
    ///
    /// Without this the screen had no way to say anything after "pedido
    /// enviado": a render that failed looked exactly like one still running,
    /// forever. The cap is generous relative to the rows a screen shows, so the
    /// newest attempt for every visible illustration is in range.
    async getIllustrationPdfStatuses(
      agentId: string,
    ): Promise<Map<string, IllustrationPdfStatus>> {
      const jobs = await repository.listRecentByOperation({
        agentId: coerceIdentifier('agentId', agentId),
        operation: 'GENERATE_ILLUSTRATION_PDF',
        limit: 200,
      })

      return latestPdfStatusByIllustration(jobs)
    },

    /// What the illustration screen is allowed to know about a quote it asked
    /// for. Deliberately not the job record: the screen needs the carrier's
    /// answer, not lease owners and attempt counts.
    async getOwnedQuoteStatus(
      agentId: string,
      jobId: string,
    ): Promise<RapidSolveQuoteStatus | null> {
      const job = await repository.findOwnedById(
        coerceIdentifier('agentId', agentId),
        coerceIdentifier('jobId', jobId),
      )

      if (!job || job.operation !== 'GET_RAPID_SOLVE_QUOTE') {
        return null
      }

      if (!isTerminalJobState(job.state)) {
        return { state: 'PENDING' }
      }

      // SUCCEEDED carries the carrier's reply, which may itself be a refusal.
      if (job.state === 'SUCCEEDED') {
        const result = job.result as { ok?: unknown } | null
        return result && typeof result === 'object' && 'ok' in result
          ? { state: 'ANSWERED', quote: result as RapidSolveQuote | RapidSolveFailure }
          : // Succeeded without a payload is not an answer. Saying so beats
            // rendering an empty quote as though the carrier had sent one.
            { state: 'UNAVAILABLE', safeErrorCode: 'QUOTE_RESULT_MISSING' }
      }

      return {
        state: 'UNAVAILABLE',
        safeErrorCode: job.safeErrorCode ?? 'QUOTE_FAILED',
      }
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

export async function enqueueRapidSolveQuote(input: {
  agentId: string
  quote: RapidSolveQuoteJobInput
}): Promise<{ jobId: string; duplicate: boolean }> {
  return createBrowserJobService().enqueueRapidSolveQuote(input)
}

export async function enqueueIllustrationPdf(input: {
  agentId: string
  illustrationId: string
  caseNameFragment?: string
}): Promise<{ jobId: string; duplicate: boolean }> {
  return createBrowserJobService().enqueueIllustrationPdf(input)
}

export async function getIllustrationPdfStatuses(
  agentId: string,
): Promise<Map<string, IllustrationPdfStatus>> {
  return createBrowserJobService().getIllustrationPdfStatuses(agentId)
}

export async function getOwnedQuoteStatus(
  agentId: string,
  jobId: string,
): Promise<RapidSolveQuoteStatus | null> {
  return createBrowserJobService().getOwnedQuoteStatus(agentId, jobId)
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

/// Requeues every job parked for want of a carrier login, for the agent whose
/// login just went through.
///
/// Takes a transaction client rather than the module's own `prisma`, so it
/// composes into whichever transaction just moved the carrier session to
/// CONNECTED: either the session is good and the queue moves, or nothing
/// changed. A window where the session connected and the queue stayed parked
/// is a queue nobody drains — and there is more than one place a session gets
/// connected (the runtime's own attempt loop, and the interactive service's
/// `completeOwnedAttempt`), so the drain lives once here rather than being
/// copied into each.
///
/// `FORESIGHT_SSO_EXPIRED` only: that is the one refusal this exact login
/// fixes. The older `NATIONAL_LIFE_RECONNECT_REQUIRED` park (from
/// `requestReconnect` in the worker) has no revival path today, on purpose —
/// see `illustration-pdf-status.ts` for why the screen does not promise one.
export async function releaseJobsBlockedOnCarrierLogin(
  tx: Prisma.TransactionClient,
  input: { agentId: string; now: Date },
): Promise<void> {
  assertBrowserJobTransition('ACTION_REQUIRED', 'QUEUED')
  await tx.browserAutomationJob.updateMany({
    where: {
      agentId: input.agentId,
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'ACTION_REQUIRED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    },
    data: { state: 'QUEUED', availableAt: input.now, safeErrorCode: null },
  })
}
