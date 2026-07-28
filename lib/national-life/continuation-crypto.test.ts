import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptMfaContinuation, encryptMfaContinuation } from './continuation-crypto'

const key = randomBytes(32).toString('base64')
const context = { agentId: 'agent-1', jobId: 'job-1', scopeId: 'scope-1' }
const continuation = {
  steelSessionId: 'steel-session-1',
  debugUrl: 'https://steel.example/session/1',
  expiresAt: '2026-07-27T12:05:00.000Z',
}

describe('National Life MFA continuation encryption', () => {
  it('round trips only with the matching agent, job and scope context', () => {
    const encrypted = encryptMfaContinuation(continuation, context, {
      version: 'v1',
      base64Key: key,
    })

    expect(
      decryptMfaContinuation(encrypted, context, { v1: key }, {
        now: () => new Date('2026-07-27T12:00:00.000Z'),
      }),
    ).toEqual(continuation)
  })

  it('rejects a continuation rebound to another agent', () => {
    const encrypted = encryptMfaContinuation(continuation, context, {
      version: 'v1',
      base64Key: key,
    })

    expect(() =>
      decryptMfaContinuation(encrypted, { ...context, agentId: 'agent-2' }, { v1: key }, {
        now: () => new Date('2026-07-27T12:00:00.000Z'),
      }),
    ).toThrow('MFA continuation decryption failed')
  })

  it('rejects a continuation rebound to another job', () => {
    const encrypted = encryptMfaContinuation(continuation, context, {
      version: 'v1',
      base64Key: key,
    })

    expect(() =>
      decryptMfaContinuation(encrypted, { ...context, jobId: 'job-2' }, { v1: key }, {
        now: () => new Date('2026-07-27T12:00:00.000Z'),
      }),
    ).toThrow('MFA continuation decryption failed')
  })

  it('rejects an expired continuation unless cleanup explicitly allows expired payloads', () => {
    const encrypted = encryptMfaContinuation(continuation, context, {
      version: 'v1',
      base64Key: key,
    })

    expect(() =>
      decryptMfaContinuation(encrypted, context, { v1: key }, {
        now: () => new Date('2026-07-27T12:06:00.000Z'),
      }),
    ).toThrow('MFA continuation expired')

    expect(
      decryptMfaContinuation(encrypted, context, { v1: key }, {
        allowExpired: true,
        now: () => new Date('2026-07-27T12:06:00.000Z'),
      }),
    ).toEqual(continuation)
  })
})
