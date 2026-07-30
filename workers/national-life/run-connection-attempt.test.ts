import { describe, expect, it, vi } from 'vitest'
import type { EncryptedBrowserSecret, AttemptRuntime } from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { NationalLifeAuthenticationState } from './adapter'
import type { BrowserSession, InteractiveBrowserSession } from './types'
import {
  cleanupNationalLifeConnectionAttempt,
  runNationalLifeConnectionAttempt,
  type RunConnectionAttemptDeps,
  type StoredConnectionAttempt,
} from './run-connection-attempt'

const now = new Date('2026-07-28T12:00:00.000Z')
const encrypted: EncryptedBrowserSecret = {
  algorithm: 'aes-256-gcm',
  keyVersion: 'v1',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'Y2lwaGVydGV4dA==',
  authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
}
const runtime: AttemptRuntime = {
  steelSessionId: 'steel-session-1',
  debugUrl: 'https://steel.example/debug/1',
  expiresAt: '2026-07-28T12:10:00.000Z',
}

function buildEnv(): NationalLifeEnv {
  return {
    steelBaseUrl: 'https://steel.example',
    steelApiKey: 'steel-key',
    portalOrigins: ['https://auth.nationallife.example', 'https://agent.nationallife.example'],
    portalLoginUrl: 'https://auth.nationallife.example/login',
    sessionScopeId: 'scope-1',
    sessionKeyVersion: 'v1',
    sessionKeys: { v1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    viewerSigningKey: Buffer.alloc(32, 2),
    viewerPublicOrigin: 'https://viewer.keepr.one',
    viewerBindHost: '127.0.0.1',
    viewerPort: 3010,
    runtimeWorkerId: 'worker-1',
    interactiveLoginEnabled: true,
    interactiveLoginAgentIds: new Set(['agent-1']),
    interactiveLoginAllAgents: false,
    viewerAppOrigins: ['https://app.keepr.one'],
  }
}

function buildAttempt(
  state: StoredConnectionAttempt['state'],
  overrides: Partial<StoredConnectionAttempt> = {},
): StoredConnectionAttempt {
  return {
    id: 'attempt-1',
    agentId: 'agent-1',
    state,
    formatVersion: 1,
    runtimeKeyVersion: state === 'OPENING_PORTAL' ? null : encrypted.keyVersion,
    runtimeAlgorithm: state === 'OPENING_PORTAL' ? null : encrypted.algorithm,
    runtimeIv: state === 'OPENING_PORTAL' ? null : encrypted.iv,
    runtimeCiphertext: state === 'OPENING_PORTAL' ? null : encrypted.ciphertext,
    runtimeAuthTag: state === 'OPENING_PORTAL' ? null : encrypted.authTag,
    currentOrigin: null,
    safeErrorCode: null,
    expiresAt: new Date('2026-07-28T12:10:00.000Z'),
    ...overrides,
  }
}

function createDeps(options: {
  attempt: StoredConnectionAttempt
  authState?: NationalLifeAuthenticationState
  classifyError?: Error & { code?: string }
  encryptContextError?: Error
  closeFailures?: number
  reconnectError?: Error
  disconnectFailures?: number
}) {
  const calls: string[] = []
  let closeFailures = options.closeFailures ?? 0
  let disconnectFailures = options.disconnectFailures ?? 0
  let current = structuredClone(options.attempt)
  let completed = false
  const page = {
    goto: vi.fn(async () => {
      calls.push('page:goto-login')
    }),
  }
  const session = {
    browser: {},
    context: {},
    page,
    steelSessionId: runtime.steelSessionId,
    debugUrl: runtime.debugUrl,
    internalDebugUrl: runtime.debugUrl,
    disconnect: vi.fn(async () => {
      calls.push('steel:disconnect')
      if (disconnectFailures > 0) {
        disconnectFailures -= 1
        throw new Error('steel disconnect failed')
      }
    }),
    close: vi.fn(async () => {
      calls.push('steel:close')
      if (closeFailures > 0) {
        closeFailures -= 1
        throw new Error('steel cleanup failed')
      }
    }),
  } as unknown as InteractiveBrowserSession

  const deps: RunConnectionAttemptDeps = {
    env: buildEnv(),
    workerId: 'worker-1',
    now: () => now,
    store: {
      async claim(attemptId) {
        if (attemptId !== current.id) return null
        calls.push(`attempt:claim:${current.state}`)
        return structuredClone(current)
      },
      async setRuntime(input) {
        calls.push(`runtime:encrypt`)
        current = {
          ...current,
          state: input.state,
          runtimeKeyVersion: input.encryptedRuntime.keyVersion,
          runtimeAlgorithm: input.encryptedRuntime.algorithm,
          runtimeIv: input.encryptedRuntime.iv,
          runtimeCiphertext: input.encryptedRuntime.ciphertext,
          runtimeAuthTag: input.encryptedRuntime.authTag,
          currentOrigin: input.currentOrigin,
        }
        calls.push(`attempt:${input.state}`)
      },
      async transition(input) {
        current = {
          ...current,
          state: input.to,
          currentOrigin: input.currentOrigin ?? current.currentOrigin,
          safeErrorCode: input.safeErrorCode ?? null,
        }
        calls.push(`attempt:${input.to}`)
      },
      async complete() {
        completed = true
        calls.push('attempt:complete-transaction')
      },
      async releaseLease() {
        calls.push('attempt:release-lease')
      },
    },
    async createInteractiveSession() {
      calls.push('steel:create-interactive')
      return session
    },
    async reconnectSession() {
      calls.push('steel:reconnect')
      if (options.reconnectError) throw options.reconnectError
      return session as BrowserSession
    },
    async captureContext() {
      calls.push('steel:context')
      return { cookies: [] }
    },
    createAdapter() {
      return {
        async classifyAuthenticationState() {
          if (options.classifyError) throw options.classifyError
          const state = options.authState ?? {
            kind: 'AUTHENTICATED',
            origin: 'https://agent.nationallife.example',
          }
          calls.push(`adapter:${state.kind}`)
          return state
        },
      } as never
    },
    crypto: {
      encryptRuntime(value) {
        expect(value).toEqual(runtime)
        return encrypted
      },
      decryptRuntime() {
        calls.push('runtime:decrypt')
        return runtime
      },
      encryptContext() {
        calls.push('context:encrypt')
        if (options.encryptContextError) throw options.encryptContextError
        return encrypted
      },
    },
  }

  return {
    calls,
    deps,
    session,
    current: () => current,
    completed: () => completed,
  }
}

describe('National Life interactive connection attempt runtime', () => {
  it('opens the carrier login once and preserves the live Steel session', async () => {
    const test = createDeps({ attempt: buildAttempt('OPENING_PORTAL') })

    await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(test.calls).toEqual([
      'attempt:claim:OPENING_PORTAL',
      'steel:create-interactive',
      'page:goto-login',
      'runtime:encrypt',
      'attempt:AWAITING_LOGIN',
      'steel:disconnect',
    ])
  })

  it('captures and atomically completes an authenticated MFA attempt', async () => {
    const test = createDeps({ attempt: buildAttempt('AWAITING_MFA') })

    await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(test.calls).toEqual([
      'attempt:claim:AWAITING_MFA',
      'runtime:decrypt',
      'steel:reconnect',
      'adapter:AUTHENTICATED',
      'steel:context',
      'context:encrypt',
      'attempt:complete-transaction',
      'steel:close',
    ])
    expect(test.completed()).toBe(true)
  })

  it('keeps MFA open when a transient reconnect fails', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_MFA'),
      reconnectError: Object.assign(
        new Error('temporary Steel reconnect failure'),
        { code: 'STEEL_RECONNECT_FAILED' },
      ),
    })

    await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(test.current()).toMatchObject({
      state: 'AWAITING_MFA',
      safeErrorCode: null,
    })
    expect(test.calls).toContain('attempt:release-lease')
    expect(test.calls).not.toContain('steel:close')
  })

  it('keeps MFA open when the page sits on an unrecognised origin', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_MFA'),
      reconnectError: Object.assign(new Error('Navigation origin is not allowed'), {
        code: 'NAVIGATION_ORIGIN_BLOCKED',
        blockedOrigin: 'https://nlg-prod.us.auth0.com',
      }),
    })

    const result = await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(result).toEqual({ kind: 'INTERACTIVE', state: 'AWAITING_MFA' })
    expect(test.current()).toMatchObject({
      state: 'AWAITING_MFA',
      currentOrigin: 'https://nlg-prod.us.auth0.com',
      safeErrorCode: 'NAVIGATION_ORIGIN_BLOCKED',
    })
    expect(test.calls).not.toContain('steel:close')
  })

  it('keeps MFA open when classification fails after reconnecting', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_MFA'),
      classifyError: new Error(
        'Execution context was destroyed, most likely because of a navigation',
      ),
    })

    const result = await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(result).toEqual({ kind: 'INTERACTIVE', state: 'AWAITING_MFA' })
    expect(test.current()).toMatchObject({ state: 'AWAITING_MFA' })
    expect(test.calls).not.toContain('steel:close')
    expect(test.calls).toContain('attempt:release-lease')
  })

  it('keeps MFA open when the local disconnect fails after a transition', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_LOGIN'),
      authState: {
        kind: 'AWAITING_MFA',
        origin: 'https://agent.nationallife.example',
      },
      disconnectFailures: 1,
    })

    const result = await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(result).toEqual({ kind: 'INTERACTIVE', state: 'AWAITING_MFA' })
    expect(test.current()).toMatchObject({ state: 'AWAITING_MFA' })
    expect(test.calls).not.toContain('steel:close')
    expect(test.calls).not.toContain('attempt:FAILED')
  })

  it('fails terminally once Steel reports the session is gone', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_MFA'),
      reconnectError: Object.assign(new Error('MFA_SESSION_EXPIRED'), {
        code: 'MFA_SESSION_EXPIRED',
      }),
    })

    const result = await runNationalLifeConnectionAttempt('attempt-1', test.deps)

    expect(result).toEqual({ kind: 'TERMINAL', state: 'FAILED' })
    expect(test.current()).toMatchObject({
      state: 'FAILED',
      safeErrorCode: 'MFA_SESSION_EXPIRED',
    })
  })

  it('leaves login open without releasing Steel', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_LOGIN'),
      authState: { kind: 'AWAITING_LOGIN', origin: 'https://auth.nationallife.example' },
    })
    await runNationalLifeConnectionAttempt('attempt-1', test.deps)
    expect(test.current()).toMatchObject({
      state: 'AWAITING_LOGIN',
      currentOrigin: 'https://auth.nationallife.example',
    })
    expect(test.calls.at(-1)).toBe('steel:disconnect')
  })

  it('moves login to MFA and preserves Steel', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_LOGIN'),
      authState: { kind: 'AWAITING_MFA', origin: 'https://auth.nationallife.example' },
    })
    await runNationalLifeConnectionAttempt('attempt-1', test.deps)
    expect(test.current().state).toBe('AWAITING_MFA')
    expect(test.calls.at(-1)).toBe('steel:disconnect')
  })

  it.each(['CANCELLED', 'EXPIRED'] as const)('cleans up a %s attempt', async (state) => {
    const test = createDeps({ attempt: buildAttempt(state) })
    await cleanupNationalLifeConnectionAttempt('attempt-1', test.deps)
    expect(test.calls).toContain('steel:close')
  })

  it('holds the login open on an unexpected origin without exposing it as runtime data', async () => {
    const error = Object.assign(new Error('blocked'), { code: 'NAVIGATION_ORIGIN_BLOCKED' })
    const test = createDeps({ attempt: buildAttempt('AWAITING_LOGIN'), classifyError: error })
    await runNationalLifeConnectionAttempt('attempt-1', test.deps)
    // The adapter error carries no origin, so nothing about the third-party page
    // is persisted; only the Steel boundary reports an origin it already parsed.
    expect(test.current()).toMatchObject({
      state: 'AWAITING_LOGIN',
      currentOrigin: null,
    })
    expect(test.calls).not.toContain('steel:close')
    expect(test.calls).toContain('attempt:release-lease')
  })

  it('never commits a connected summary when context encryption fails', async () => {
    const test = createDeps({
      attempt: buildAttempt('AWAITING_MFA'),
      encryptContextError: new Error('encryption failed'),
    })
    await runNationalLifeConnectionAttempt('attempt-1', test.deps)
    expect(test.completed()).toBe(false)
    expect(test.current().state).toBe('FAILED')
  })

  it('allows Steel cleanup to be retried after a transient failure', async () => {
    const test = createDeps({ attempt: buildAttempt('CANCELLED'), closeFailures: 1 })
    await expect(cleanupNationalLifeConnectionAttempt('attempt-1', test.deps)).rejects.toThrow(
      'steel cleanup failed',
    )
    await expect(cleanupNationalLifeConnectionAttempt('attempt-1', test.deps)).resolves.toEqual({
      kind: 'CLEANED',
    })
    expect(test.session.close).toHaveBeenCalledTimes(2)
  })
})
