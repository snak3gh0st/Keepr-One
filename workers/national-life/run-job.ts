import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  decryptBrowserContext,
  type EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import {
  FORESIGHT_SSO_EXPIRED,
  NATIONAL_LIFE_RECONNECT_REQUIRED,
} from '../../lib/national-life/constants'
import type {
  BrowserJobRecord,
  CaseReadSyncJobInput,
  ForesightPdfJobInput,
  ForesightReadJobInput,
  IllustrationPdfJobInput,
  NationalLifeGridJobInput,
  RapidSolveQuoteJobInput,
} from '../../lib/national-life/job-service'
import type { ForesightRunStore } from '../../lib/national-life/foresight-run-service'
import { isPdfPayload } from '../../lib/national-life/foresight-report'
import type {
  ForesightCaseListing,
  ForesightServiceObservation,
} from '../../lib/national-life/foresight-sync'
import {
  buildRapidSolveRequest,
  type RapidSolveFailure,
  type RapidSolveQuote,
  type RapidSolveRequest,
  type SolveType,
} from '../../lib/national-life/rapid-solve'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import {
  NATIONAL_LIFE_SYNC_GRID_KEYS,
  type GridSyncResult,
} from '../../lib/national-life/sync-grid'
import { redactDiagnostic } from '../../lib/national-life/redaction'
import type {
  BrowserSession,
  NationalLifeCaseObservation,
} from './types'

const TRANSIENT_RETRY_DELAY_MS = 2 * 60_000
const AUTHENTICATION_STATE_INVALID = 'AUTHENTICATION_STATE_INVALID'
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
  /// The browser the human logged in on, if it is still being held. Null means
  /// no live browser — the ordinary state, and the one that existed before this
  /// field: the job builds its own from the stored context.
  liveSteelSessionId: string | null
}

type NationalLifeJobAdapter = {
  openPortalHome(): Promise<void>
  assertAuthenticated(): Promise<void>
  readForesight(input: { targetCaseKey?: string }): Promise<{
    cases: ForesightCaseListing[]
    selectedCase: ForesightCaseListing | null
    services: ForesightServiceObservation[]
  }>
  readCase(
    lookup: CaseReadSyncJobInput['lookup'],
  ): Promise<NationalLifeCaseObservation>
  requestRapidSolveQuote(
    request: RapidSolveRequest,
  ): Promise<RapidSolveQuote | RapidSolveFailure>
  renderForesightReport(
    caseNameFragment?: string,
  ): Promise<{ caseName: string; bytes: Buffer; mimeType: string } | null>
  syncGrid(input: {
    gridKey: NationalLifeGridJobInput['gridKey']
    agentId: string
    deploymentScope: string
    fetchedAt: Date
  }): Promise<GridSyncResult>
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

export type ForesightRunWorkerStore = ForesightRunStore & {
  findCase(input: {
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
  }): Promise<{ id: string; externalKey: string; displayName: string } | null>
  saveInventory(input: {
    runId: string
    agentId: string
    deploymentScope: string
    cases: ForesightCaseListing[]
    observedAt: Date
  }): Promise<Map<string, string>>
  saveService(input: {
    runId: string
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
    observation: ForesightServiceObservation
    observedAt: Date
  }): Promise<void>
  saveDocument(input: {
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
    reportKey: string
    caseName: string
    bytes: Buffer
    mimeType: string
    fetchedAt: Date
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
    /// Writes the context back as the browser left it. See `captureContext`.
    saveContext(
      sessionId: string,
      context: SessionContext,
      capturedAt: Date,
    ): Promise<void>
  }
  /// Reads the live browser's cookies at the end of a job.
  ///
  /// Crossing the carrier's SSO — which the Foresight report does on every run
  /// — rotates the `auth0` cookie inside this browser. Closing without writing
  /// the rotation back leaves the next job presenting a superseded cookie, and
  /// the IdP treats that as replay: the session dies with nobody having logged
  /// out. The standalone scripts have always done this in `finally`; the worker
  /// did not, which is why the session died ten minutes after the PDF job of
  /// 2026-07-31 14:53 UTC.
  captureContext(session: BrowserSession): Promise<SessionContext>
  decryptContext?(
    storedSession: StoredAgentIntegrationSession,
  ): SessionContext
  createSession(sessionContext: SessionContext): Promise<BrowserSession>
  /// Reattaches to the browser the human logged in on, when one is still held.
  ///
  /// This is the difference between a browser that already holds the
  /// illustration tool's token in page memory and one that does not: a rebuilt
  /// browser has to cross the identity provider again, and crossing is what
  /// burns the carrier session. Failure here is ordinary — the browser may be
  /// long gone — and falls back to `createSession`.
  reattachSession(steelSessionId: string): Promise<BrowserSession>
  createAdapter(session: BrowserSession): NationalLifeJobAdapter
  /// Serialises against every other thing that opens the carrier browser —
  /// the connection-attempt loop in this process and the cron scripts in
  /// theirs. Steel runs one Chrome for this deployment, so two at once kill
  /// each other mid-navigation. Returns null when the wait ran out, which is
  /// contention rather than failure and so re-queues instead of failing.
  runExclusively<T>(work: () => Promise<T>): Promise<T | null>
  /// Keeps a priced quote after the screen that asked for it is gone. Written
  /// here rather than by the browser that polls, so closing the tab cannot
  /// lose a request already made against the carrier.
  saveIllustration(input: {
    agentId: string
    clientId?: string | null
    jobId: string
    insuredName: string
    insuredDateOfBirth: string
    productCode: string
    quote: RapidSolveQuote
    request: RapidSolveRequest
  }): Promise<{ illustrationId: string }>
  /// Files the rendered PDF on the illustration it belongs to. Separate from
  /// saveIllustration because the document arrives long after the numbers did,
  /// from a different carrier system, and may never arrive at all.
  saveIllustrationDocument(input: {
    illustrationId: string
    bytes: Buffer
    mimeType: string
    fetchedAt: Date
  }): Promise<void>
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
  syncRunStore: {
    reconcile(runId: string, agentId: string): Promise<void>
  }
  foresightRunStore: ForesightRunWorkerStore
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

function isIllustrationPdfInput(
  input: BrowserJobRecord['input'],
): input is IllustrationPdfJobInput {
  return 'illustrationId' in input
}

function isNationalLifeGridInput(
  input: BrowserJobRecord['input'],
): input is NationalLifeGridJobInput {
  return (
    'syncRunId' in input &&
    typeof input.syncRunId === 'string' &&
    'gridKey' in input &&
    typeof input.gridKey === 'string' &&
    (NATIONAL_LIFE_SYNC_GRID_KEYS as readonly string[]).includes(input.gridKey)
  )
}

function isForesightReadInput(
  input: BrowserJobRecord['input'],
): input is ForesightReadJobInput {
  if (
    'foresightRunId' in input &&
    typeof input.foresightRunId === 'string' &&
    input.foresightRunId.length > 0 &&
    'mode' in input &&
    (input.mode === 'INVENTORY' || input.mode === 'DETAIL')
  ) {
    return input.mode === 'INVENTORY'
      ? !('targetCaseId' in input)
      : 'targetCaseId' in input &&
          typeof input.targetCaseId === 'string' &&
          input.targetCaseId.length > 0
  }
  return false
}

function isForesightPdfInput(
  input: BrowserJobRecord['input'],
): input is ForesightPdfJobInput {
  return (
    'caseSnapshotId' in input &&
    typeof input.caseSnapshotId === 'string' &&
    input.caseSnapshotId.length > 0 &&
    'caseKey' in input &&
    typeof input.caseKey === 'string' &&
    input.caseKey.length > 0
  )
}

async function reconcileForesightRun(
  input: ForesightReadJobInput | null,
  job: BrowserJobRecord,
  deps: Pick<NationalLifeRunJobDeps, 'env' | 'foresightRunStore'>,
): Promise<void> {
  if (!input) return
  await deps.foresightRunStore.reconcile({
    runId: input.foresightRunId,
    agentId: job.agentId,
    deploymentScope: deps.env.sessionScopeId,
  })
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
    safeErrorCode: NATIONAL_LIFE_RECONNECT_REQUIRED,
  })
}

/// Sends a job back to the queue for a later attempt.
///
/// Two transitions, because RUNNING cannot go straight to QUEUED and because
/// RETRYABLE on its own is a dead end: the only thing that revives a job is
/// `releaseExpiredLeases`, and that looks exclusively at RUNNING jobs with
/// lapsed leases. A job parked in RETRYABLE is never claimed and never fails —
/// it just stops, and the screen polling it shows "pending" forever.
async function requeueForRetry(
  job: BrowserJobRecord,
  deps: Pick<NationalLifeRunJobDeps, 'jobStore' | 'now'>,
  input: { safeErrorCode: string; safeErrorDetail?: unknown },
): Promise<void> {
  const availableAt = new Date(deps.now().getTime() + TRANSIENT_RETRY_DELAY_MS)

  await deps.jobStore.transitionJob({
    jobId: job.id,
    from: 'RUNNING',
    to: 'RETRYABLE',
    safeErrorCode: input.safeErrorCode,
    safeErrorDetail: input.safeErrorDetail,
  })

  await deps.jobStore.transitionJob({
    jobId: job.id,
    from: 'RETRYABLE',
    to: 'QUEUED',
    availableAt,
  })
}

/// What went wrong, for the branch that has no idea.
///
/// This branch used to store nothing but `UNEXPECTED_WORKER_FAILURE`, so the
/// first real quote failed in under three seconds and left no way to tell
/// whether the browser, the lock, the carrier or our own code had done it.
///
/// URLs are dropped rather than redacted by key. A Playwright or Steel message
/// often has the session's debug URL inside the sentence, where a key-based
/// redactor cannot see it — and this value is persisted and shown.
export function describeUnexpectedFailure(error: unknown): unknown {
  const withoutUrls = (text: string) =>
    text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[URL]').slice(0, 500)

  if (error instanceof Error) {
    return redactDiagnostic({
      name: error.name,
      message: withoutUrls(error.message),
      // The first frame is usually enough to say which of our files threw,
      // and the rest is noise from the runtime's own internals.
      at: withoutUrls((error.stack ?? '').split('\n')[1]?.trim() ?? ''),
      // Where an adapter error keeps the fact that matters — the HTTP status
      // the carrier answered with. Dropping it left "the carrier did not
      // answer" without saying how it did not answer.
      detail: getErrorSafeDetail(error),
    })
  }

  return redactDiagnostic({ message: withoutUrls(String(error)) })
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

  // A dead carrier session is a refusal a login fixes, so the request
  // waits for one instead of being thrown away. The worker only claims QUEUED,
  // so nothing here keeps knocking on the carrier while it waits — which
  // matters, because crossing the identity provider is what burns the session.
  if (code === FORESIGHT_SSO_EXPIRED) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'ACTION_REQUIRED',
      safeErrorCode: FORESIGHT_SSO_EXPIRED,
    })
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
    await requeueForRetry(job, deps, {
      safeErrorCode: 'TRANSIENT_WORKER_FAILURE',
    })
    return
  }

  await deps.jobStore.transitionJob({
    jobId: job.id,
    from: 'RUNNING',
    to: 'FAILED',
    // When our own code named the failure, say that name. Overwriting
    // `RAPID_SOLVE_REQUEST_FAILED` with `UNEXPECTED_WORKER_FAILURE` threw away
    // the one word that said where to look.
    safeErrorCode: code ?? 'UNEXPECTED_WORKER_FAILURE',
    safeErrorDetail: describeUnexpectedFailure(error),
  })
}

/// The browser this job will drive.
///
/// Prefers the one the human logged in on, because it still holds the
/// illustration tool's in-memory token; falls back to building one from the
/// stored cookies, which is what every job did before the browser was kept.
/// The fallback is not a degraded mode to be alarmed about — it is the old
/// behaviour, and it is correct, just more expensive at the identity provider.
type OpenCarrierBrowserResult = {
  session: BrowserSession
  reusedLiveSession: boolean
}

async function openCarrierBrowser(
  storedSession: StoredAgentIntegrationSession,
  sessionContext: SessionContext,
  deps: NationalLifeRunJobDeps,
): Promise<OpenCarrierBrowserResult> {
  if (storedSession.liveSteelSessionId) {
    try {
      return {
        session: await deps.reattachSession(storedSession.liveSteelSessionId),
        reusedLiveSession: true,
      }
    } catch {
      // Gone: Steel restarted, the session hit its ceiling, or the day rolled
      // over. Nothing to report — the cookies still work.
    }
  }
  return {
    session: await deps.createSession(sessionContext),
    reusedLiveSession: false,
  }
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
  const pdfInput =
    job.operation === 'GENERATE_ILLUSTRATION_PDF' && isIllustrationPdfInput(job.input)
      ? job.input
      : null
  const gridInput =
    job.operation === 'SYNC_NATIONAL_LIFE_GRID' && isNationalLifeGridInput(job.input)
      ? job.input
      : null
  const foresightReadInput =
    job.operation === 'SYNC_FORESIGHT_READ' && isForesightReadInput(job.input)
      ? job.input
      : null
  const foresightPdfInput =
    job.operation === 'GENERATE_FORESIGHT_PDF' && isForesightPdfInput(job.input)
      ? job.input
      : null

  if (!quoteInput && !caseInput && !pdfInput && !gridInput && !foresightReadInput && !foresightPdfInput) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'FAILED',
      safeErrorCode: 'UNSUPPORTED_JOB_OPERATION',
    })
    if (typeof job.input === 'object' && 'syncRunId' in job.input && typeof job.input.syncRunId === 'string') {
      await deps.syncRunStore.reconcile(job.input.syncRunId, job.agentId)
    }
    return { kind: 'COMPLETED' }
  }

  const foresightDetailSnapshot =
    foresightReadInput?.mode === 'DETAIL'
      ? await deps.foresightRunStore.findCase({
          agentId: job.agentId,
          deploymentScope: deps.env.sessionScopeId,
          caseSnapshotId: foresightReadInput.targetCaseId!,
        })
      : null
  if (foresightReadInput?.mode === 'DETAIL' && !foresightDetailSnapshot) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'FAILED',
      safeErrorCode: 'FORESIGHT_CASE_NOT_FOUND',
    })
    await reconcileForesightRun(foresightReadInput, job, deps)
    return { kind: 'COMPLETED' }
  }

  const foresightPdfSnapshot = foresightPdfInput
    ? await deps.foresightRunStore.findCase({
        agentId: job.agentId,
        deploymentScope: deps.env.sessionScopeId,
        caseSnapshotId: foresightPdfInput.caseSnapshotId,
      })
    : null
  if (
    foresightPdfInput &&
    (!foresightPdfSnapshot || foresightPdfSnapshot.externalKey !== foresightPdfInput.caseKey)
  ) {
    await deps.jobStore.transitionJob({
      jobId: job.id,
      from: 'RUNNING',
      to: 'FAILED',
      safeErrorCode: 'FORESIGHT_CASE_NOT_FOUND',
    })
    return { kind: 'COMPLETED' }
  }

  const storedSession = await deps.sessionStore.findForAgent(
    job.agentId,
    job.provider,
  )
  if (!isUsableSession(storedSession, deps.now())) {
    await requestReconnect(job, deps)
    if (gridInput) await deps.syncRunStore.reconcile(gridInput.syncRunId, job.agentId)
    await reconcileForesightRun(foresightReadInput, job, deps)
    return { kind: 'COMPLETED' }
  }

  let sessionContext: SessionContext
  try {
    sessionContext = deps.decryptContext
      ? deps.decryptContext(storedSession!)
      : decryptStoredContext(storedSession!, deps.env)
  } catch {
    await requestReconnect(job, deps)
    if (gridInput) await deps.syncRunStore.reconcile(gridInput.syncRunId, job.agentId)
    await reconcileForesightRun(foresightReadInput, job, deps)
    return { kind: 'COMPLETED' }
  }

  try {
    const ran = await deps.runExclusively(async () => {
      // Opened and closed inside the lock. Steel runs one Chrome for this
      // deployment, so releasing while this session is still tearing down
      // would let the next holder build a session on top of it — the
      // "browser has been closed" failure the lock exists to prevent.
      let browserSession: BrowserSession | undefined
      let reusedLiveSession = false

      try {
        const opened = await openCarrierBrowser(storedSession!, sessionContext, deps)
        browserSession = opened.session
        reusedLiveSession = opened.reusedLiveSession
        const adapter = deps.createAdapter(browserSession)
        // A restored session opens blank, and the authentication check reads
        // the page's origin — so without this every job failed before doing
        // anything, blaming a navigation it had never made.
        await adapter.openPortalHome()
        await adapter.assertAuthenticated()
        await deps.sessionStore.markUsed(storedSession!.id, deps.now())

        // Everything above is shared: claim, session, reconnect-on-unusable,
        // authentication. Only the question asked of the carrier differs.
        if (quoteInput) {
          const request = rapidSolveRequestFrom(quoteInput, deps.now())
          const quote = await adapter.requestRapidSolveQuote(request)

          // Only a priced quote becomes an illustration. A refusal is a real
          // answer and the job keeps it, but there is no premium and no face
          // amount to file, and a row of zeros would read as a quote of zero.
          if (quote.ok) {
            await deps.saveIllustration({
              agentId: job.agentId,
              clientId: quoteInput.clientId ?? null,
              jobId: job.id,
              insuredName: `${quoteInput.firstName} ${quoteInput.lastName}`.trim(),
              insuredDateOfBirth: quoteInput.dateOfBirth,
              productCode: quoteInput.productCode,
              quote,
              request,
            })
          }

          // A refusal is an answer. SUCCEEDED means "we asked and the carrier
          // replied"; FAILED is reserved for not having been able to ask.
          // Routing a refusal through handleFailure would redact the carrier's
          // own sentence, which is the one thing the agent needs to read.
          await deps.jobStore.transitionJob({
            jobId: job.id,
            from: 'RUNNING',
            to: 'SUCCEEDED',
            result: quote,
          })
        } else if (pdfInput) {
          // The carrier holds the case; we hold the row it belongs to. A case
          // it cannot find is an answer, not a crash — the quote may predate
          // the tool ever seeing it — so it succeeds with `rendered: false`
          // rather than routing a plain "not there" through error redaction.
          const rendered = await adapter.renderForesightReport(pdfInput.caseNameFragment)

          if (rendered) {
            await deps.saveIllustrationDocument({
              illustrationId: pdfInput.illustrationId,
              bytes: rendered.bytes,
              mimeType: rendered.mimeType,
              fetchedAt: deps.now(),
            })
          }

          await deps.jobStore.transitionJob({
            jobId: job.id,
            from: 'RUNNING',
            to: 'SUCCEEDED',
            // Never the bytes: a job result is read back into the UI and a
            // megabyte and a half of PDF does not belong in it.
            result: rendered
              ? { rendered: true, caseName: rendered.caseName, bytes: rendered.bytes.byteLength }
              : { rendered: false },
          })
        } else if (foresightPdfInput && foresightPdfSnapshot) {
          const rendered = await adapter.renderForesightReport(foresightPdfInput.caseKey)
          if (!rendered) {
            throw Object.assign(new Error('Foresight did not return a report'), {
              code: 'FORESIGHT_REPORT_FAILED',
            })
          }
          if (rendered.caseName !== foresightPdfInput.caseKey) {
            throw Object.assign(new Error('Foresight rendered a different case'), {
              code: 'FORESIGHT_CASE_NOT_FOUND',
            })
          }
          if (rendered.mimeType !== 'application/pdf' || !isPdfPayload(rendered.bytes)) {
            throw Object.assign(new Error('Foresight returned an invalid report payload'), {
              code: 'FORESIGHT_REPORT_FAILED',
            })
          }
          await deps.foresightRunStore.saveDocument({
            agentId: job.agentId,
            deploymentScope: deps.env.sessionScopeId,
            caseSnapshotId: foresightPdfSnapshot.id,
            reportKey: 'foresight-report',
            caseName: rendered.caseName,
            bytes: rendered.bytes,
            mimeType: rendered.mimeType,
            fetchedAt: deps.now(),
          })
          await deps.jobStore.transitionJob({
            jobId: job.id,
            from: 'RUNNING',
            to: 'SUCCEEDED',
            result: {
              caseSnapshotId: foresightPdfSnapshot.id,
              rendered: true,
              bytes: rendered.bytes.byteLength,
            },
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
        } else if (gridInput) {
          const result = await adapter.syncGrid({
            gridKey: gridInput.gridKey,
            agentId: job.agentId,
            deploymentScope: deps.env.sessionScopeId,
            fetchedAt: deps.now(),
          })

          await deps.jobStore.transitionJob({
            jobId: job.id,
            from: 'RUNNING',
            to: 'SUCCEEDED',
            result,
          })
        } else if (foresightReadInput) {
          const observedAt = deps.now()
          if (foresightReadInput.mode === 'INVENTORY') {
            const result = await adapter.readForesight({})
            await deps.foresightRunStore.saveInventory({
              runId: foresightReadInput.foresightRunId,
              agentId: job.agentId,
              deploymentScope: deps.env.sessionScopeId,
              cases: result.cases,
              observedAt,
            })
            await deps.foresightRunStore.updateProgress({
              runId: foresightReadInput.foresightRunId,
              agentId: job.agentId,
              deploymentScope: deps.env.sessionScopeId,
              patch: {
                totalCases: result.cases.length,
                inventoriedCases: result.cases.length,
                totalServices: 0,
                completedServices: 0,
                currentCaseName: null,
                currentService: null,
              },
            })
            await deps.jobStore.transitionJob({
              jobId: job.id,
              from: 'RUNNING',
              to: 'SUCCEEDED',
              result: { inventoriedCases: result.cases.length },
            })
          } else {
            const snapshot = foresightDetailSnapshot
            if (!snapshot) {
              throw Object.assign(new Error('Foresight case snapshot was not found'), {
                code: 'FORESIGHT_CASE_NOT_FOUND',
              })
            }

            const result = await adapter.readForesight({ targetCaseKey: snapshot.externalKey })
            if (result.selectedCase?.externalKey !== snapshot.externalKey) {
              throw Object.assign(new Error('Foresight returned a different case'), {
                code: 'FORESIGHT_CASE_NOT_FOUND',
              })
            }
            await deps.foresightRunStore.updateProgress({
              runId: foresightReadInput.foresightRunId,
              agentId: job.agentId,
              deploymentScope: deps.env.sessionScopeId,
              patch: {
                totalCases: 1,
                inventoriedCases: 1,
                totalServices: result.services.length,
                completedServices: 0,
                currentCaseName: snapshot.displayName,
                currentService: null,
              },
            })
            for (const [index, observation] of result.services.entries()) {
              await deps.foresightRunStore.saveService({
                runId: foresightReadInput.foresightRunId,
                agentId: job.agentId,
                deploymentScope: deps.env.sessionScopeId,
                caseSnapshotId: snapshot.id,
                observation,
                observedAt,
              })
              await deps.foresightRunStore.updateProgress({
                runId: foresightReadInput.foresightRunId,
                agentId: job.agentId,
                deploymentScope: deps.env.sessionScopeId,
                patch: {
                  totalCases: 1,
                  inventoriedCases: 1,
                  totalServices: result.services.length,
                  completedServices: index + 1,
                  currentCaseName: snapshot.displayName,
                  currentService: observation.serviceName,
                },
              })
            }
            await deps.jobStore.transitionJob({
              jobId: job.id,
              from: 'RUNNING',
              to: 'SUCCEEDED',
              result: { caseSnapshotId: snapshot.id, servicesRead: result.services.length },
            })
          }
        }

        return 'ran'
      } finally {
        // Before the close, not after: the cookies have to be read while the
        // browser is still up. Never allowed to fail the job — the carrier was
        // already asked and already answered, and reporting an error over a
        // lost rotation would make a retry ask again.
        if (browserSession) {
          try {
            await deps.sessionStore.saveContext(
              storedSession!.id,
              await deps.captureContext(browserSession),
              deps.now(),
            )
          } catch {
            // Nothing to do here but leave the stored context as it was. The
            // next job either works or asks for a reconnect, which is the
            // same path an ordinary expiry takes.
          }
        }
        if (browserSession) {
          // A reattached browser belongs to the authenticated session, not to
          // this job. Disconnect the CDP client but keep Steel/Foresight alive.
          // A fallback browser belongs to this job and is released here.
          if (reusedLiveSession) {
            await browserSession.disconnect()
          } else {
            await browserSession.close()
          }
        }
      }
    })

    // Another carrier browser held the lock past the deadline. Nothing was
    // asked of the carrier, so this is not a failure — re-queue and let the
    // next tick try. Failing here would report "we asked and it went wrong"
    // about a request that was never made.
    if (ran === null) {
      await requeueForRetry(job, deps, { safeErrorCode: 'CARRIER_BROWSER_BUSY' })
    }
  } catch (error) {
    await handleFailure(job, error, deps)
  }

  if (gridInput) {
    await deps.syncRunStore.reconcile(gridInput.syncRunId, job.agentId)
  }
  await reconcileForesightRun(foresightReadInput, job, deps)

  return { kind: 'COMPLETED' }
}
