import { randomBytes } from 'node:crypto'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import { describe, expect, it } from 'vitest'
import {
  decryptAttemptRuntime,
  decryptBrowserContext,
  encryptAttemptRuntime,
  encryptBrowserContext,
  type BrowserContextBinding,
} from './browser-context-crypto'

const key = randomBytes(32).toString('base64')
const activeKey = { version: 'v1', base64Key: key }
const keyRing = { v1: key }

const context: SessionContext = {
  cookies: [
    {
      name: 'nlg-session',
      value: 'carrier-secret',
      domain: '.nationallife.example',
    },
  ],
  localStorage: {
    'https://agent.nationallife.example': { preference: 'compact' },
  },
  sessionStorage: {
    'https://agent.nationallife.example': { flow: 'agent' },
  },
  indexedDB: {},
}

const binding: BrowserContextBinding = {
  agentId: 'agent-1',
  scopeId: 'keepr-one-production',
  provider: 'NATIONAL_LIFE',
  purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
  formatVersion: 1,
}

describe('National Life browser context encryption', () => {
  it('round trips a Steel session context without exposing cookie values', () => {
    const encrypted = encryptBrowserContext(context, binding, activeKey)

    expect(decryptBrowserContext(encrypted, binding, keyRing)).toEqual(context)
    expect(JSON.stringify(encrypted)).not.toContain('carrier-secret')
  })

  it.each([
    ['agentId', 'agent-2'],
    ['scopeId', 'keepr-one-staging'],
    ['provider', 'OTHER_PROVIDER'],
    ['purpose', 'INTERACTIVE_ATTEMPT_RUNTIME'],
    ['formatVersion', 2],
  ] as const)('rejects ciphertext when the %s AAD binding changes', (field, value) => {
    const encrypted = encryptBrowserContext(context, binding, activeKey)
    const changedBinding = {
      ...binding,
      [field]: value,
    } as BrowserContextBinding

    expect(() => decryptBrowserContext(encrypted, changedBinding, keyRing)).toThrow(
      'Browser context decryption failed',
    )
  })

  it.each([
    ['unknown algorithm', { algorithm: 'aes-128-gcm' }],
    ['missing key version', { keyVersion: 'v2' }],
    ['malformed IV base64', { iv: '***' }],
    ['malformed ciphertext base64', { ciphertext: '***' }],
    ['malformed auth tag base64', { authTag: '***' }],
    ['empty ciphertext', { ciphertext: '' }],
  ])('rejects %s with the generic decryption error', (_case, replacement) => {
    const encrypted = encryptBrowserContext(context, binding, activeKey)

    expect(() =>
      decryptBrowserContext(
        { ...encrypted, ...replacement } as typeof encrypted,
        binding,
        keyRing,
      ),
    ).toThrow('Browser context decryption failed')
  })

  it('rejects unexpected Steel session context fields before encryption', () => {
    const invalidContext = {
      ...context,
      password: 'must-not-be-persisted',
    } as unknown as SessionContext

    expect(() => encryptBrowserContext(invalidContext, binding, activeKey)).toThrow(
      'Browser context encryption failed',
    )
  })

  it('round trips an interactive attempt runtime with its own purpose binding', () => {
    const runtime = {
      steelSessionId: 'steel-session-1',
      debugUrl: 'https://steel.example/session/1',
      expiresAt: '2026-07-28T12:05:00.000Z',
    }
    const runtimeBinding: BrowserContextBinding = {
      ...binding,
      purpose: 'INTERACTIVE_ATTEMPT_RUNTIME',
    }
    const encrypted = encryptAttemptRuntime(runtime, runtimeBinding, activeKey)

    expect(decryptAttemptRuntime(encrypted, runtimeBinding, keyRing)).toEqual(runtime)
    expect(() =>
      decryptAttemptRuntime(encrypted, binding, keyRing),
    ).toThrow('Browser context decryption failed')
  })

  it('rejects unexpected interactive attempt runtime fields before encryption', () => {
    const runtimeBinding: BrowserContextBinding = {
      ...binding,
      purpose: 'INTERACTIVE_ATTEMPT_RUNTIME',
    }
    const invalidRuntime = {
      steelSessionId: 'steel-session-1',
      debugUrl: 'https://steel.example/session/1',
      expiresAt: '2026-07-28T12:05:00.000Z',
      mfaCode: 'must-not-be-persisted',
    }

    expect(() =>
      encryptAttemptRuntime(invalidRuntime, runtimeBinding, activeKey),
    ).toThrow('Browser context encryption failed')
  })
})
