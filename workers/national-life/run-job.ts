import { decryptCredential } from '../../lib/national-life/credential-crypto'
import { decryptMfaContinuation, encryptMfaContinuation, type MfaContinuation } from '../../lib/national-life/continuation-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { BrowserJobRecord, CaseReadSyncJobInput } from '../../lib/national-life/job-service'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import { redactDiagnostic } from '../../lib/national-life/redaction'
import type { BrowserSession, NationalLifeCaseObservation, NationalLifeCredentials } from './types'

const MFA_CONTINUATION_TTL_MS = 5 * 60_000
const TRANSIENT_RETRY_DELAY_MS = 2 * 60_000

const CREDENTIALS_EXPIRED_CODES = new Set(['AUTHENTICATION_STATE_INVALID'])
const MANUAL_REVIEW_CODES = new Set([
  'PORTAL_LAYOUT_CHANGED',
  'SCHEMA_VALIDATION_FAILED',
  'UNEXPECTED_APPLICATION_IDENTIFIER',
])
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN'])

export type StoredNationalLifeCredential = {
  agentId: string
  provider: string
  algorithm: 'aes-256-gcm'
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
}

type NationalLifeLoginResult = { kind: 'CONNECTED' } | { kind: 'MFA_REQUIRED'; resumeHint: string }

type NationalLifeJobAdapter = {
  login(credentials: NationalLifeCredentials): Promise<NationalLifeLoginResult>
  readCase(lookup: CaseReadSyncJobInput['lookup']): Promise<NationalLifeCaseObservation>
}

export type NationalLifeContinuationPatch = {
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
}

export type NationalLifeJobStore = {
  claimJob(input: { jobId: string }): Promise<BrowserJobRecord | null>
  transitionJob(input: {
    jobId: string
    from: BrowserJobState
    to: BrowserJobState
    result?: unknown
    safeErrorCode?: string
    safeErrorDetail?: unknown
    availableAt?: Date
    continuation?: NationalLifeContinuationPatch
    continuationExpiresAt?: Date | null
  }): Promise<void>
  clearContinuation(jobId: string): Promise<void>
}

export type NationalLifeRunJobDeps = {
  env: NationalLifeEnv
  workerId: string
  now: () => Date
  jobStore: NationalLifeJobStore
  credentialStore: {
    findForAgent(agentId: string, provider: string): Promise<StoredNationalLifeCredential | null>
  }
  createSession(): Promise<BrowserSession>
  reconnectSession(continuation: MfaContinuation): Promise<BrowserSession>
  createAdapter(session: BrowserSession): NationalLifeJobAdapter
  applyCaseObservation(input: {
    agentId: string
    caseId: string
    applicationId: string
    jobId: string
    observation: NationalLifeCaseObservation
  }): Promise<{ changed: boolean; requirementChanges: number; communicationChanges: number }>
}

export type RunNationalLifeJobResult = { kind: 'NOT_CLAIMED' } | { kind: 'COMPLETED' }

function isCaseReadSyncInput(input: BrowserJobRecord['input']): input is CaseReadSyncJobInput {
  return 'lookup' in input
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return undefined
}

function getErrorSafeDetail(error: unknown): unknown {
  if (error instanceof Error && 'safeDetail' in error) {
    return (error as { safeDetail?: unknown }).safeDetail
  }
  return undefined
}

function buildContinuationSecret(job: BrowserJobRecord): NationalLifeContinuationPatch | undefined {
  if (!job.continuationKeyVersion || !job.continuationIv || !job.continuationCiphertext || !job.continuationAuthTag) {
    return undefined
  }

  return {
    keyVersion: job.continuationKeyVersion,
    iv: job.continuationIv,
    ciphertext: job.continuationCiphertext,
    authTag: job.continuationAuthTag,
  }
}

async function handleFailure(
  jobId: string,
  error: unknown,
  deps: Pick<NationalLifeRunJobDeps, 'jobStore' | 'now'>,
): Promise<void> {
  const code = getErrorCode(error)

  if (code && CREDENTIALS_EXPIRED_CODES.has(code)) {
    await deps.jobStore.transitionJob({
      jobId,
      from: 'RUNNING',
      to: 'CREDENTIALS_EXPIRED',
      safeErrorCode: 'CREDENTIALS_EXPIRED',
    })
    return
  }

  if (code && MANUAL_REVIEW_CODES.has(code)) {
    await deps.jobStore.transitionJob({
      jobId,
      from: 'RUNNING',
      to: 'MANUAL_REVIEW',
      safeErrorCode: code,
      safeErrorDetail: redactDiagnostic(getErrorSafeDetail(error)),
    })
    return
  }

  if (code && TRANSIENT_CODES.has(code)) {
    await deps.jobStore.transitionJob({
      jobId,
      from: 'RUNNING',
      to: 'RETRYABLE',
      safeErrorCode: 'TRANSIENT_WORKER_FAILURE',
      availableAt: new Date(deps.now().getTime() + TRANSIENT_RETRY_DELAY_MS),
    })
    return
  }

  await deps.jobStore.transitionJob({
    jobId,
    from: 'RUNNING',
    to: 'FAILED',
    safeErrorCode: 'UNEXPECTED_WORKER_FAILURE',
  })
}

export async function runNationalLifeJob(
  jobId: string,
  deps: NationalLifeRunJobDeps,
): Promise<RunNationalLifeJobResult> {
  const job = await deps.jobStore.claimJob({ jobId })

  if (!job) {
    return { kind: 'NOT_CLAIMED' }
  }

  if (!isCaseReadSyncInput(job.input)) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'FAILED',
      safeErrorCode: 'UNSUPPORTED_JOB_OPERATION',
    })
    return { kind: 'COMPLETED' }
  }

  const { input } = job
  let session: BrowserSession | undefined
  let preserveForMfa = false

  try {
    const existingContinuation = buildContinuationSecret(job)
    let observation: NationalLifeCaseObservation

    if (existingContinuation) {
      const continuation = decryptMfaContinuation(
        { algorithm: 'aes-256-gcm', ...existingContinuation },
        { agentId: job.agentId, jobId: job.id, scopeId: deps.env.credentialScopeId },
        deps.env.credentialKeys,
        { now: deps.now },
      )

      session = await deps.reconnectSession(continuation)
      const adapter = deps.createAdapter(session)
      observation = await adapter.readCase(input.lookup)
    } else {
      const stored = await deps.credentialStore.findForAgent(job.agentId, job.provider)

      if (!stored) {
        await deps.jobStore.transitionJob({
          jobId: job.id,
          from: 'RUNNING',
          to: 'CREDENTIALS_EXPIRED',
          safeErrorCode: 'CREDENTIALS_MISSING',
        })
        return { kind: 'COMPLETED' }
      }

      const credentials = decryptCredential(
        stored,
        { agentId: job.agentId, scopeId: deps.env.credentialScopeId, provider: job.provider },
        deps.env.credentialKeys,
      )

      session = await deps.createSession()
      const adapter = deps.createAdapter(session)
      const loginResult = await adapter.login(credentials)

      if (loginResult.kind === 'MFA_REQUIRED') {
        const expiresAt = new Date(deps.now().getTime() + MFA_CONTINUATION_TTL_MS)
        const encrypted = encryptMfaContinuation(
          { steelSessionId: session.steelSessionId, debugUrl: session.debugUrl, expiresAt: expiresAt.toISOString() },
          { agentId: job.agentId, jobId: job.id, scopeId: deps.env.credentialScopeId },
          { version: deps.env.credentialKeyVersion, base64Key: deps.env.credentialKeys[deps.env.credentialKeyVersion] },
        )

        preserveForMfa = true
        await deps.jobStore.transitionJob({
          jobId: job.id,
          from: 'RUNNING',
          to: 'WAITING_FOR_MFA',
          result: { resumeHint: loginResult.resumeHint, continuationExpiresAt: expiresAt.toISOString() },
          continuation: encrypted,
          continuationExpiresAt: expiresAt,
        })
        return { kind: 'COMPLETED' }
      }

      observation = await adapter.readCase(input.lookup)
    }

    const syncResult = await deps.applyCaseObservation({
      agentId: job.agentId,
      caseId: input.caseId,
      applicationId: input.applicationId,
      jobId: job.id,
      observation,
    })

    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'SUCCEEDED',
      result: syncResult,
    })

    return { kind: 'COMPLETED' }
  } catch (error) {
    await handleFailure(job.id, error, deps)
    return { kind: 'COMPLETED' }
  } finally {
    if (session) {
      if (preserveForMfa) {
        await session.disconnect()
      } else {
        await session.close()
      }
    }
  }
}

export async function releaseNationalLifeMfaContinuation(
  job: BrowserJobRecord,
  deps: {
    env: NationalLifeEnv
    now: () => Date
    jobStore: Pick<NationalLifeJobStore, 'clearContinuation'>
    reconnectSession: (continuation: MfaContinuation) => Promise<BrowserSession>
  },
): Promise<void> {
  const continuationSecret = buildContinuationSecret(job)

  if (!continuationSecret) {
    return
  }

  const continuation = decryptMfaContinuation(
    { algorithm: 'aes-256-gcm', ...continuationSecret },
    { agentId: job.agentId, jobId: job.id, scopeId: deps.env.credentialScopeId },
    deps.env.credentialKeys,
    { now: deps.now, allowExpired: true },
  )

  const session = await deps.reconnectSession(continuation)
  await session.close()
  await deps.jobStore.clearContinuation(job.id)
}
