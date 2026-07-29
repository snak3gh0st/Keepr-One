import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  decryptBrowserContext,
  type EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type {
  BrowserJobRecord,
  CaseReadSyncJobInput,
} from '../../lib/national-life/job-service'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import { redactDiagnostic } from '../../lib/national-life/redaction'
import type {
  BrowserSession,
  NationalLifeCaseObservation,
} from './types'

const TRANSIENT_RETRY_DELAY_MS = 2 * 60_000
const AUTHENTICATION_STATE_INVALID = 'AUTHENTICATION_STATE_INVALID'
const RECONNECT_REQUIRED = 'NATIONAL_LIFE_RECONNECT_REQUIRED'
const MANUAL_REVIEW_CODES = new Set([
  'PORTAL_LAYOUT_CHANGED',
  'SCHEMA_VALIDATION_FAILED',
  'UNEXPECTED_APPLICATION_IDENTIFIER',
])
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
])

export type StoredAgentIntegrationSession = {
  id: string
  agentId: string
  provider: string
  status: string
  formatVersion: number
  keyVersion: string | null
  algorithm: string | null
  iv: string | null
  ciphertext: string | null
  authTag: string | null
  carrierExpiresAt: Date | null
  lastConnectedAt: Date
  lastUsedAt: Date | null
}

type NationalLifeJobAdapter = {
  assertAuthenticated(): Promise<void>
  readCase(
    lookup: CaseReadSyncJobInput['lookup'],
  ): Promise<NationalLifeCaseObservation>
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
  }): Promise<void>
}

export type NationalLifeRunJobDeps = {
  env: NationalLifeEnv
  workerId: string
  now: () => Date
  jobStore: NationalLifeJobStore
  sessionStore: {
    findForAgent(
      agentId: string,
      provider: string,
    ): Promise<StoredAgentIntegrationSession | null>
    markUsed(sessionId: string, usedAt: Date): Promise<void>
    invalidate(agentId: string, provider: string): Promise<void>
  }
  decryptContext?(
    storedSession: StoredAgentIntegrationSession,
  ): SessionContext
  createSession(sessionContext: SessionContext): Promise<BrowserSession>
  createAdapter(session: BrowserSession): NationalLifeJobAdapter
  applyCaseObservation(input: {
    agentId: string
    caseId: string
    applicationId: string
    jobId: string
    observation: NationalLifeCaseObservation
  }): Promise<{
    changed: boolean
    requirementChanges: number
    communicationChanges: number
  }>
}

export type RunNationalLifeJobResult =
  | { kind: 'NOT_CLAIMED' }
  | { kind: 'COMPLETED' }

function isCaseReadSyncInput(
  input: BrowserJobRecord['input'],
): input is CaseReadSyncJobInput {
  return 'lookup' in input
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
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

function getSessionCryptoConfig(env: NationalLifeEnv) {
  return {
    scopeId: env.sessionScopeId,
    keys: env.sessionKeys,
  }
}

function encryptedContextFromSession(
  session: StoredAgentIntegrationSession,
): EncryptedBrowserSecret | null {
  if (
    session.status !== 'CONNECTED' ||
    session.formatVersion !== 1 ||
    !session.keyVersion ||
    session.algorithm !== 'aes-256-gcm' ||
    !session.iv ||
    !session.ciphertext ||
    !session.authTag
  ) {
    return null
  }
  return {
    keyVersion: session.keyVersion,
    algorithm: 'aes-256-gcm',
    iv: session.iv,
    ciphertext: session.ciphertext,
    authTag: session.authTag,
  }
}

function decryptStoredContext(
  session: StoredAgentIntegrationSession,
  env: NationalLifeEnv,
) {
  const encrypted = encryptedContextFromSession(session)
  if (!encrypted) {
    throw new Error('Stored National Life session is incomplete')
  }
  const crypto = getSessionCryptoConfig(env)
  return decryptBrowserContext(
    encrypted,
    {
      agentId: session.agentId,
      scopeId: crypto.scopeId,
      provider: session.provider,
      purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
      formatVersion: 1,
    },
    crypto.keys,
  )
}

function isUsableSession(
  session: StoredAgentIntegrationSession | null,
  now: Date,
) {
  return Boolean(
    session &&
      encryptedContextFromSession(session) &&
      (!session.carrierExpiresAt || session.carrierExpiresAt > now),
  )
}

async function requestReconnect(
  job: BrowserJobRecord,
  deps: Pick<NationalLifeRunJobDeps, 'jobStore' | 'sessionStore'>,
) {
  await deps.sessionStore.invalidate(job.agentId, job.provider)
  await deps.jobStore.transitionJob({
    jobId: job.id,
    from: 'RUNNING',
    to: 'ACTION_REQUIRED',
    safeErrorCode: RECONNECT_REQUIRED,
  })
}

async function handleFailure(
  job: BrowserJobRecord,
  error: unknown,
  deps: Pick<
    NationalLifeRunJobDeps,
    'jobStore' | 'sessionStore' | 'now'
  >,
): Promise<void> {
  const code = getErrorCode(error)

  if (code === AUTHENTICATION_STATE_INVALID) {
    await requestReconnect(job, deps)
    return
  }

  if (code && MANUAL_REVIEW_CODES.has(code)) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'MANUAL_REVIEW',
      safeErrorCode: code,
      safeErrorDetail: redactDiagnostic(getErrorSafeDetail(error)),
    })
    return
  }

  if (code && TRANSIENT_CODES.has(code)) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'RETRYABLE',
      safeErrorCode: 'TRANSIENT_WORKER_FAILURE',
      availableAt: new Date(deps.now().getTime() + TRANSIENT_RETRY_DELAY_MS),
    })
    return
  }

  await deps.jobStore.transitionJob({
    jobId: job.id,
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

  const storedSession = await deps.sessionStore.findForAgent(
    job.agentId,
    job.provider,
  )
  if (!isUsableSession(storedSession, deps.now())) {
    await requestReconnect(job, deps)
    return { kind: 'COMPLETED' }
  }

  let sessionContext: SessionContext
  try {
    sessionContext = deps.decryptContext
      ? deps.decryptContext(storedSession!)
      : decryptStoredContext(storedSession!, deps.env)
  } catch {
    await requestReconnect(job, deps)
    return { kind: 'COMPLETED' }
  }

  let browserSession: BrowserSession | undefined

  try {
    browserSession = await deps.createSession(sessionContext)
    const adapter = deps.createAdapter(browserSession)
    await adapter.assertAuthenticated()
    await deps.sessionStore.markUsed(storedSession!.id, deps.now())

    const observation = await adapter.readCase(job.input.lookup)
    const syncResult = await deps.applyCaseObservation({
      agentId: job.agentId,
      caseId: job.input.caseId,
      applicationId: job.input.applicationId,
      jobId: job.id,
      observation,
    })

    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'SUCCEEDED',
      result: syncResult,
    })
  } catch (error) {
    await handleFailure(job, error, deps)
  } finally {
    await browserSession?.close()
  }

  return { kind: 'COMPLETED' }
}
