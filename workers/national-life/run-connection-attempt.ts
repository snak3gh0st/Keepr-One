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

  const extendedEnv = deps.env as NationalLifeEnv & {
    sessionScopeId?: string
    sessionKeyVersion?: string
    sessionKeys?: Record<string, string>
  }
  const scopeId = extendedEnv.sessionScopeId ?? deps.env.credentialScopeId
  const keyVersion =
    extendedEnv.sessionKeyVersion ?? deps.env.credentialKeyVersion
  const keys = extendedEnv.sessionKeys ?? deps.env.credentialKeys
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

function safeErrorCode(error: unknown) {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    const code = (error as Error & { code: string }).code
    if (
      code === 'NAVIGATION_ORIGIN_BLOCKED' ||
      code === 'PORTAL_LAYOUT_CHANGED' ||
      code === 'MFA_SESSION_EXPIRED'
    ) {
      return code
    }
  }
  return 'INTERACTIVE_CONNECTION_FAILED'
}

export async function runNationalLifeConnectionAttempt(
  attemptId: string,
  deps: RunConnectionAttemptDeps,
): Promise<RunConnectionAttemptResult> {
  const attempt = await deps.store.claim(attemptId, deps.workerId, deps.now())
  if (!attempt) {
    return { kind: 'NOT_CLAIMED' }
  }

  if (attempt.expiresAt <= deps.now() && attempt.state !== 'EXPIRED') {
    await deps.store.transition({
      attemptId,
      workerId: deps.workerId,
      from: attempt.state,
      to: 'EXPIRED',
      safeErrorCode: 'CONNECTION_ATTEMPT_EXPIRED',
      now: deps.now(),
    })
    await cleanupAttemptRecord({ ...attempt, state: 'EXPIRED' }, deps)
    return { kind: 'TERMINAL', state: 'EXPIRED' }
  }

  if (
    attempt.state === 'CANCELLED' ||
    attempt.state === 'EXPIRED' ||
    attempt.state === 'FAILED'
  ) {
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
    await session.disconnect()
    return { kind: 'INTERACTIVE', state: 'AWAITING_LOGIN' }
  } catch (error) {
    if (session) {
      await session.close()
    }
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

  let session: BrowserSession | undefined
  try {
    const runtime = resolveCrypto(deps).decryptRuntime(encryptedRuntime, attempt)
    session = await deps.reconnectSession(runtime)
    const authentication = await deps
      .createAdapter(session)
      .classifyAuthenticationState()

    if (authentication.kind !== 'AUTHENTICATED') {
      await deps.store.transition({
        attemptId: attempt.id,
        workerId: deps.workerId,
        from: attempt.state,
        to: authentication.kind,
        currentOrigin: authentication.origin,
        now: deps.now(),
      })
      await session.disconnect()
      return { kind: 'INTERACTIVE', state: authentication.kind }
    }

    const context = await deps.captureContext(session.steelSessionId)
    const encryptedContext = resolveCrypto(deps).encryptContext(context, attempt)
    await deps.store.complete({
      attemptId: attempt.id,
      agentId: attempt.agentId,
      workerId: deps.workerId,
      encryptedContext,
      carrierExpiresAt: null,
      now: deps.now(),
    })
    await session.close()
    return { kind: 'CONNECTED' }
  } catch (error) {
    if (session) {
      await session.close()
    }
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
