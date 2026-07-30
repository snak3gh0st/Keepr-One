import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  decryptBrowserContext,
  type EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type {
  BrowserJobRecord,
  CaseReadSyncJobInput,
  RapidSolveQuoteJobInput,
} from '../../lib/national-life/job-service'
import {
  buildRapidSolveRequest,
  type RapidSolveFailure,
  type RapidSolveQuote,
  type RapidSolveRequest,
  type SolveType,
} from '../../lib/national-life/rapid-solve'
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
  requestRapidSolveQuote(
    request: RapidSolveRequest,
  ): Promise<RapidSolveQuote | RapidSolveFailure>
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
  /// Serialises against every other thing that opens the carrier browser —
  /// the connection-attempt loop in this process and the cron scripts in
  /// theirs. Steel runs one Chrome for this deployment, so two at once kill
  /// each other mid-navigation. Returns null when the wait ran out, which is
  /// contention rather than failure and so re-queues instead of failing.
  runExclusively<T>(work: () => Promise<T>): Promise<T | null>
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

function isRapidSolveQuoteInput(
  input: BrowserJobRecord['input'],
): input is RapidSolveQuoteJobInput {
  return 'solveType' in input && 'productCode' in input
}

/// Rebuilds the carrier request from the row. The date crossed the queue as the
/// carrier's own `MM/DD/YYYY` string, so it is parsed back in UTC — the same
/// zone `toCarrierDate` wrote it in. Reading it as local time would shift the
/// day either side of midnight and, through age-nearest-birthday, silently
/// misprice the quote by a year.
function rapidSolveRequestFrom(
  input: RapidSolveQuoteJobInput,
  now: Date,
): RapidSolveRequest {
  const [month, day, year] = input.dateOfBirth.split('/').map(Number)

  return buildRapidSolveRequest(
    {
      issueState: input.issueState,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: new Date(Date.UTC(year, month - 1, day)),
      gender: input.gender,
      rateClass: input.rateClass,
      solveType: input.solveType as SolveType,
      amount: input.amount,
      deathBenefitOption: input.deathBenefitOption,
      strategy: input.strategy,
      allocation: input.allocation,
      productCode: input.productCode,
    },
    now,
  )
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

  // Checked before any session work, so an operation this worker cannot run
  // never costs a carrier browser. The operation and the payload have to agree:
  // a row claiming one and carrying the other is a corrupt job, not a job to
  // guess at.
  const quoteInput =
    job.operation === 'GET_RAPID_SOLVE_QUOTE' && isRapidSolveQuoteInput(job.input)
      ? job.input
      : null
  const caseInput =
    job.operation === 'SYNC_CASE_READ' && isCaseReadSyncInput(job.input) ? job.input : null

  if (!quoteInput && !caseInput) {
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
    const ran = await deps.runExclusively(async () => {
      browserSession = await deps.createSession(sessionContext)
      const adapter = deps.createAdapter(browserSession)
      await adapter.assertAuthenticated()
      await deps.sessionStore.markUsed(storedSession!.id, deps.now())

      // Everything above is shared: claim, session, reconnect-on-unusable,
      // authentication. Only the question asked of the carrier differs.
      if (quoteInput) {
        const quote = await adapter.requestRapidSolveQuote(
          rapidSolveRequestFrom(quoteInput, deps.now()),
        )

        // A refusal is an answer. SUCCEEDED means "we asked and the carrier
        // replied"; FAILED is reserved for not having been able to ask. Routing
        // a refusal through handleFailure would redact the carrier's own
        // sentence, which is the one thing the agent needs to read.
        await deps.jobStore.transitionJob({
          jobId: job.id,
          from: 'RUNNING',
          to: 'SUCCEEDED',
          result: quote,
        })
      } else if (caseInput) {
        const observation = await adapter.readCase(caseInput.lookup)
        const syncResult = await deps.applyCaseObservation({
          agentId: job.agentId,
          caseId: caseInput.caseId,
          applicationId: caseInput.applicationId,
          jobId: job.id,
          observation,
        })

        await deps.jobStore.transitionJob({
          jobId: job.id,
          from: 'RUNNING',
          to: 'SUCCEEDED',
          result: syncResult,
        })
      }

      return 'ran'
    })

    // Another carrier browser held the lock past the deadline. Nothing was
    // asked of the carrier, so this is not a failure — re-queue and let the
    // next tick try. Failing here would report "we asked and it went wrong"
    // about a request that was never made.
    if (ran === null) {
      await deps.jobStore.transitionJob({
        jobId: job.id,
        from: 'RUNNING',
        to: 'RETRYABLE',
        safeErrorCode: 'CARRIER_BROWSER_BUSY',
        availableAt: new Date(deps.now().getTime() + TRANSIENT_RETRY_DELAY_MS),
      })
    }
  } catch (error) {
    await handleFailure(job, error, deps)
  } finally {
    await browserSession?.close()
  }

  return { kind: 'COMPLETED' }
}
