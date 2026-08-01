import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  decryptAttemptRuntime,
  encryptAttemptRuntime,
  encryptBrowserContext,
  type AttemptRuntime,
  type EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeConnectionAttemptState } from '../../lib/national-life/connection-attempt-state'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { NationalLifeAdapter } from './adapter'
import { traceReason, type ConnectionTrace } from './connection-trace'
import type { BrowserSession, InteractiveBrowserSession } from './types'

export type StoredConnectionAttempt = {
  id: string
  agentId: string
  state: NationalLifeConnectionAttemptState
  formatVersion: number
  runtimeKeyVersion: string | null
  runtimeAlgorithm: string | null
  runtimeIv: string | null
  runtimeCiphertext: string | null
  runtimeAuthTag: string | null
  currentOrigin: string | null
  safeErrorCode: string | null
  expiresAt: Date
}

export type SetAttemptRuntimeInput = {
  attemptId: string
  workerId: string
  from: 'OPENING_PORTAL'
  state: 'AWAITING_LOGIN'
  encryptedRuntime: EncryptedBrowserSecret
  currentOrigin: string
  now: Date
}

export type TransitionAttemptInput = {
  attemptId: string
  workerId: string
  from: NationalLifeConnectionAttemptState
  to: NationalLifeConnectionAttemptState
  currentOrigin?: string
  safeErrorCode?: string
  now: Date
}

export type CompleteAttemptInput = {
  attemptId: string
  agentId: string
  workerId: string
  encryptedContext: EncryptedBrowserSecret
  carrierExpiresAt: Date | null
  /// The Steel session the human logged in on, handed over rather than closed.
  ///
  /// The illustration tool keeps its token in the page's memory, so a browser
  /// rebuilt from cookies wakes up without one and has to cross the identity
  /// provider again — which is what kept burning the session. Jobs reattach to
  /// this one instead.
  ///
  /// Null is a legitimate value, not a failure: it means no live browser was
  /// handed over and every job builds its own from the stored context, which is
  /// exactly the behaviour that existed before.
  liveSteelSessionId: string | null
  now: Date
}

type ConnectionAttemptCrypto = {
  encryptRuntime(runtime: AttemptRuntime, attempt: StoredConnectionAttempt): EncryptedBrowserSecret
  decryptRuntime(encrypted: EncryptedBrowserSecret, attempt: StoredConnectionAttempt): AttemptRuntime
  encryptContext(context: SessionContext, attempt: StoredConnectionAttempt): EncryptedBrowserSecret
}

export type RunConnectionAttemptDeps = {
  env: NationalLifeEnv
  workerId: string
  now: () => Date
  store: {
    claim(attemptId: string, workerId: string, now: Date): Promise<StoredConnectionAttempt | null>
    setRuntime(input: SetAttemptRuntimeInput): Promise<void>
    transition(input: TransitionAttemptInput): Promise<void>
    complete(input: CompleteAttemptInput): Promise<void>
    releaseLease(attemptId: string): Promise<void>
  }
  createInteractiveSession(): Promise<InteractiveBrowserSession>
  reconnectSession(runtime: AttemptRuntime): Promise<BrowserSession>
  captureContext(steelSessionId: string): Promise<SessionContext>
  createAdapter(session: BrowserSession): Pick<NationalLifeAdapter, 'classifyAuthenticationState'>
  crypto?: ConnectionAttemptCrypto
  /// One line per decision on the way through. Optional so tests that do not
  /// care can leave it out; production always supplies it, because a login
  /// costs a human and an MFA code and must not produce a mystery.
  trace?: ConnectionTrace
}

export type RunConnectionAttemptResult =
  | { kind: 'NOT_CLAIMED' }
  | { kind: 'INTERACTIVE'; state: 'AWAITING_LOGIN' | 'AWAITING_MFA' }
  | { kind: 'CONNECTED' }
  | { kind: 'TERMINAL'; state: 'FAILED' | 'CANCELLED' | 'EXPIRED' }

function encryptedRuntimeFromAttempt(
  attempt: StoredConnectionAttempt,
): EncryptedBrowserSecret | null {
  if (
    !attempt.runtimeKeyVersion ||
    attempt.runtimeAlgorithm !== 'aes-256-gcm' ||
    !attempt.runtimeIv ||
    !attempt.runtimeCiphertext ||
    !attempt.runtimeAuthTag
  ) {
    return null
  }
  return {
    algorithm: 'aes-256-gcm',
    keyVersion: attempt.runtimeKeyVersion,
    iv: attempt.runtimeIv,
    ciphertext: attempt.runtimeCiphertext,
    authTag: attempt.runtimeAuthTag,
  }
}

function resolveCrypto(deps: RunConnectionAttemptDeps): ConnectionAttemptCrypto {
  if (deps.crypto) {
    return deps.crypto
  }

  const scopeId = deps.env.sessionScopeId
  const keyVersion = deps.env.sessionKeyVersion
  const keys = deps.env.sessionKeys
  const activeKey = { version: keyVersion, base64Key: keys[keyVersion] }

  return {
    encryptRuntime(runtime, attempt) {
      return encryptAttemptRuntime(
        runtime,
        {
          agentId: attempt.agentId,
          scopeId,
          provider: 'NATIONAL_LIFE',
          purpose: 'INTERACTIVE_ATTEMPT_RUNTIME',
          formatVersion: 1,
        },
        activeKey,
      )
    },
    decryptRuntime(encrypted, attempt) {
      return decryptAttemptRuntime(
        encrypted,
        {
          agentId: attempt.agentId,
          scopeId,
          provider: 'NATIONAL_LIFE',
          purpose: 'INTERACTIVE_ATTEMPT_RUNTIME',
          formatVersion: 1,
        },
        keys,
      )
    },
    encryptContext(context, attempt) {
      return encryptBrowserContext(
        context,
        {
          agentId: attempt.agentId,
          scopeId,
          provider: 'NATIONAL_LIFE',
          purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
          formatVersion: 1,
        },
        activeKey,
      )
    },
  }
}

const NAVIGATION_ORIGIN_BLOCKED_CODE = 'NAVIGATION_ORIGIN_BLOCKED'
const STEEL_RECONNECT_FAILED_CODE = 'STEEL_RECONNECT_FAILED'
const MFA_SESSION_EXPIRED_CODE = 'MFA_SESSION_EXPIRED'

function errorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as Error & { code: string }).code
  }
  return undefined
}

function safeErrorCode(error: unknown) {
  const code = errorCode(error)
  if (
    code === NAVIGATION_ORIGIN_BLOCKED_CODE ||
    code === 'PORTAL_LAYOUT_CHANGED' ||
    code === MFA_SESSION_EXPIRED_CODE ||
    code === STEEL_RECONNECT_FAILED_CODE
  ) {
    return code
  }
  return 'INTERACTIVE_CONNECTION_FAILED'
}

function blockedOriginFrom(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    'blockedOrigin' in error &&
    typeof (error as { blockedOrigin?: unknown }).blockedOrigin === 'string'
  ) {
    return (error as Error & { blockedOrigin: string }).blockedOrigin
  }
  return undefined
}

// Local teardown of the CDP client must never escalate into releasing the Steel
// session: a human may be mid-MFA on that browser.
async function safeDisconnect(session: BrowserSession | undefined) {
  if (!session) {
    return
  }
  try {
    await session.disconnect()
  } catch {
    // The next poll reconnects; the carrier page stays alive either way.
  }
}

async function safeClose(session: BrowserSession | undefined) {
  if (!session) {
    return
  }
  try {
    await session.close()
  } catch {
    // Best-effort cleanup only.
  }
}

export async function runNationalLifeConnectionAttempt(
  attemptId: string,
  deps: RunConnectionAttemptDeps,
): Promise<RunConnectionAttemptResult> {
  const attempt = await deps.store.claim(attemptId, deps.workerId, deps.now())
  if (!attempt) {
    return { kind: 'NOT_CLAIMED' }
  }
  deps.trace?.({
    step: 'claimed',
    attemptId,
    state: attempt.state,
    expiresInMs: attempt.expiresAt.getTime() - deps.now().getTime(),
  })

  if (attempt.expiresAt <= deps.now() && attempt.state !== 'EXPIRED') {
    await deps.store.transition({
      attemptId,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'EXPIRED',
      safeErrorCode: 'CONNECTION_ATTEMPT_EXPIRED',
      now: deps.now(),
    })
    deps.trace?.({ step: 'expired', attemptId, state: attempt.state })
    await cleanupAttemptRecord({ ...attempt, state: 'EXPIRED' }, deps)
    return { kind: 'TERMINAL', state: 'EXPIRED' }
  }

  if (
    attempt.state === 'CANCELLED' ||
    attempt.state === 'EXPIRED' ||
    attempt.state === 'FAILED'
  ) {
    deps.trace?.({ step: 'terminal', attemptId, state: attempt.state })
    await cleanupAttemptRecord(attempt, deps)
    return { kind: 'TERMINAL', state: attempt.state }
  }

  if (attempt.state === 'OPENING_PORTAL') {
    return openPortal(attempt, deps)
  }

  return monitorPortal(attempt, deps)
}

async function openPortal(
  attempt: StoredConnectionAttempt,
  deps: RunConnectionAttemptDeps,
): Promise<RunConnectionAttemptResult> {
  let session: InteractiveBrowserSession | undefined
  try {
    session = await deps.createInteractiveSession()
    deps.trace?.({
      step: 'session-created',
      attemptId: attempt.id,
      steelSessionId: session.steelSessionId,
    })
    await session.page.goto(deps.env.portalLoginUrl)
    const runtime: AttemptRuntime = {
      steelSessionId: session.steelSessionId,
      debugUrl: session.internalDebugUrl,
      expiresAt: attempt.expiresAt.toISOString(),
    }
    const encryptedRuntime = resolveCrypto(deps).encryptRuntime(runtime, attempt)
    await deps.store.setRuntime({
      attemptId: attempt.id,
      workerId: deps.workerId,
      from: 'OPENING_PORTAL',
      state: 'AWAITING_LOGIN',
      encryptedRuntime,
      currentOrigin: new URL(deps.env.portalLoginUrl).origin,
      now: deps.now(),
    })
    await safeDisconnect(session)
    return { kind: 'INTERACTIVE', state: 'AWAITING_LOGIN' }
  } catch (error) {
    // `session` still undefined means the browser was never created — the exact
    // fact that could not be established after 2026-07-31's login.
    deps.trace?.(
      session
        ? { step: 'failed', attemptId: attempt.id, reason: traceReason(error) }
        : { step: 'session-create-failed', attemptId: attempt.id, reason: traceReason(error) },
    )
    await safeClose(session)
    await deps.store.transition({
      attemptId: attempt.id,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'FAILED',
      safeErrorCode: safeErrorCode(error),
      now: deps.now(),
    })
    return { kind: 'TERMINAL', state: 'FAILED' }
  }
}

async function monitorPortal(
  attempt: StoredConnectionAttempt,
  deps: RunConnectionAttemptDeps,
): Promise<RunConnectionAttemptResult> {
  const encryptedRuntime = encryptedRuntimeFromAttempt(attempt)
  if (!encryptedRuntime) {
    await deps.store.transition({
      attemptId: attempt.id,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'FAILED',
      safeErrorCode: 'ATTEMPT_RUNTIME_MISSING',
      now: deps.now(),
    })
    return { kind: 'TERMINAL', state: 'FAILED' }
  }

  // Decrypted up front: an unreadable runtime blob can never be fixed by
  // retrying, so it must not reach the recoverable path below.
  let runtime: AttemptRuntime
  try {
    runtime = resolveCrypto(deps).decryptRuntime(encryptedRuntime, attempt)
  } catch {
    await deps.store.transition({
      attemptId: attempt.id,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'FAILED',
      safeErrorCode: 'ATTEMPT_RUNTIME_MISSING',
      now: deps.now(),
    })
    return { kind: 'TERMINAL', state: 'FAILED' }
  }

  let session: BrowserSession | undefined
  let authenticated = false
  try {
    session = await deps.reconnectSession(runtime)
    // Which browser it came back on. If a login ever completes on a session id
    // Steel does not have, this line is what says so at the time rather than
    // hours later.
    deps.trace?.({
      step: 'session-reconnected',
      attemptId: attempt.id,
      steelSessionId: session.steelSessionId,
    })
    const authentication = await deps
      .createAdapter(session)
      .classifyAuthenticationState()
    deps.trace?.({
      step: 'classified',
      attemptId: attempt.id,
      kind: authentication.kind,
      origin: authentication.origin,
    })

    if (authentication.kind !== 'AUTHENTICATED') {
      await deps.store.transition({
        attemptId: attempt.id,
        workerId: deps.workerId,
        from: attempt.state,
        to: authentication.kind,
        currentOrigin: authentication.origin,
        now: deps.now(),
      })
      await safeDisconnect(session)
      return { kind: 'INTERACTIVE', state: authentication.kind }
    }

    // Past this point the human is done and any failure is ours to own, so the
    // recoverable path below must not swallow it.
    authenticated = true
    const context = await deps.captureContext(session.steelSessionId)
    const encryptedContext = resolveCrypto(deps).encryptContext(context, attempt)
    await deps.store.complete({
      attemptId: attempt.id,
      agentId: attempt.agentId,
      workerId: deps.workerId,
      encryptedContext,
      carrierExpiresAt: null,
      liveSteelSessionId: session.steelSessionId,
      now: deps.now(),
    })
    // Disconnect, never close. This is the browser the human just authenticated
    // on, and the illustration tool's token lives in its page memory — closing
    // it here is what forced every later job to cross the identity provider
    // again, which is what burns the carrier session. Dropping only the local
    // CDP client leaves the browser standing for the jobs to reattach to.
    //
    // The cookies were captured above regardless, so if this browser is gone by
    // the time a job looks for it, the job builds its own and nothing is lost.
    deps.trace?.({
      step: 'completed',
      attemptId: attempt.id,
      steelSessionId: session.steelSessionId,
    })
    await safeDisconnect(session)
    return { kind: 'CONNECTED' }
  } catch (error) {
    deps.trace?.({ step: 'failed', attemptId: attempt.id, reason: traceReason(error) })
    const interactiveState = interactiveStateOf(attempt)
    if (
      !authenticated &&
      interactiveState &&
      isRecoverableInteractiveFailure(error)
    ) {
      // The carrier browser is still live and a human may be mid-MFA on it.
      // Drop only the local CDP client and let the next poll try again.
      await safeDisconnect(session)
      await recordInteractiveObservation(attempt, interactiveState, deps, error)
      return { kind: 'INTERACTIVE', state: interactiveState }
    }

    await safeClose(session)
    await deps.store.transition({
      attemptId: attempt.id,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'FAILED',
      safeErrorCode: safeErrorCode(error),
      now: deps.now(),
    })
    return { kind: 'TERMINAL', state: 'FAILED' }
  }
}

function interactiveStateOf(
  attempt: StoredConnectionAttempt,
): 'AWAITING_LOGIN' | 'AWAITING_MFA' | undefined {
  if (attempt.state === 'AWAITING_LOGIN' || attempt.state === 'AWAITING_MFA') {
    return attempt.state
  }
  return undefined
}

// While the attempt is interactive the human owns that browser, and no failure
// here proves it is gone: a transport blip is transient, an off-allowlist page
// only means the login walked through a hop we do not recognise yet, and an
// unreadable page usually means it navigated mid-classification. Only a session
// Steel has already declared dead is terminal. The attempt TTL and the user's
// cancel button bound the retries.
function isRecoverableInteractiveFailure(error: unknown) {
  return errorCode(error) !== MFA_SESSION_EXPIRED_CODE
}

// Surfaces the unrecognised origin on the attempt row so the missing entry in
// NATIONAL_LIFE_PORTAL_ORIGINS is visible without reproducing blind. Stays in
// the same state, so the viewer keeps running.
async function recordInteractiveObservation(
  attempt: StoredConnectionAttempt,
  interactiveState: 'AWAITING_LOGIN' | 'AWAITING_MFA',
  deps: RunConnectionAttemptDeps,
  error: unknown,
) {
  const blockedOrigin = blockedOriginFrom(error)

  if (blockedOrigin && blockedOrigin !== attempt.currentOrigin) {
    try {
      await deps.store.transition({
        attemptId: attempt.id,
        workerId: deps.workerId,
        from: interactiveState,
        to: interactiveState,
        currentOrigin: blockedOrigin,
        safeErrorCode: safeErrorCode(error),
        now: deps.now(),
      })
      return
    } catch {
      // Fall through: releasing the lease matters more than the diagnostic.
    }
  }

  await deps.store.releaseLease(attempt.id)
}

async function cleanupAttemptRecord(
  attempt: StoredConnectionAttempt,
  deps: RunConnectionAttemptDeps,
) {
  const encryptedRuntime = encryptedRuntimeFromAttempt(attempt)
  if (encryptedRuntime) {
    const runtime = resolveCrypto(deps).decryptRuntime(encryptedRuntime, attempt)
    const session = await deps.reconnectSession(runtime)
    await session.close()
  }
  await deps.store.releaseLease(attempt.id)
}

export async function cleanupNationalLifeConnectionAttempt(
  attemptId: string,
  deps: RunConnectionAttemptDeps,
): Promise<{ kind: 'NOT_CLAIMED' } | { kind: 'CLEANED' }> {
  const attempt = await deps.store.claim(attemptId, deps.workerId, deps.now())
  if (!attempt) {
    return { kind: 'NOT_CLAIMED' }
  }
  await cleanupAttemptRecord(attempt, deps)
  return { kind: 'CLEANED' }
}
