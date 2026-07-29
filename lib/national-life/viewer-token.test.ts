import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  createViewerBootstrapToken,
  createViewerSessionToken,
  hashViewerNonce,
  verifyViewerBootstrapToken,
  verifyViewerSessionToken,
} from './viewer-token'

const signingKey = Buffer.alloc(32, 4)
const now = new Date('2026-07-28T12:00:00.000Z')

function decodePayload(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
}

describe('National Life viewer tokens', () => {
  it('creates a valid one-time bootstrap token and returns only the nonce hash for storage', () => {
    const issued = createViewerBootstrapToken(
      {
        attemptId: 'attempt-1',
        agentId: 'agent-1',
        expiresAt: '2026-07-28T12:05:00.000Z',
      },
      signingKey,
      () => Buffer.alloc(32, 7),
    )

    expect(verifyViewerBootstrapToken(issued.token, signingKey, now)).toMatchObject({
      attemptId: 'attempt-1',
      agentId: 'agent-1',
    })
    expect(issued.token).not.toContain('steel.example')
    expect(hashViewerNonce(issued.nonce)).toBe(issued.nonceHash)
    expect(issued.nonceHash).not.toBe(issued.nonce)
  })

  it('rejects signature tampering', () => {
    const issued = createViewerBootstrapToken(
      {
        attemptId: 'attempt-1',
        agentId: 'agent-1',
        expiresAt: '2026-07-28T12:05:00.000Z',
      },
      signingKey,
      () => Buffer.alloc(32, 7),
    )
    const [payload, signature] = issued.token.split('.')
    const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`

    expect(() =>
      verifyViewerBootstrapToken(`${payload}.${tamperedSignature}`, signingKey, now),
    ).toThrow()
  })

  it('rejects an expired bootstrap token', () => {
    const issued = createViewerBootstrapToken(
      {
        attemptId: 'attempt-1',
        agentId: 'agent-1',
        expiresAt: '2026-07-28T11:59:59.000Z',
      },
      signingKey,
      () => Buffer.alloc(32, 7),
    )

    expect(() => verifyViewerBootstrapToken(issued.token, signingKey, now)).toThrow()
  })

  it('rejects a token issued for the wrong viewer purpose', () => {
    const sessionToken = createViewerSessionToken(
      {
        attemptId: 'attempt-1',
        agentId: 'agent-1',
        expiresAt: '2026-07-28T12:05:00.000Z',
      },
      signingKey,
    )

    expect(() => verifyViewerBootstrapToken(sessionToken, signingKey, now)).toThrow()
  })

  it('creates and verifies a broker-session token without upstream details', () => {
    const token = createViewerSessionToken(
      {
        attemptId: 'attempt-1',
        agentId: 'agent-1',
        expiresAt: '2026-07-28T12:05:00.000Z',
      },
      signingKey,
    )

    expect(verifyViewerSessionToken(token, signingKey, now)).toEqual({
      purpose: 'NATIONAL_LIFE_VIEWER_SESSION',
      attemptId: 'attempt-1',
      agentId: 'agent-1',
      expiresAt: '2026-07-28T12:05:00.000Z',
    })
    expect(token).not.toContain('steel.example')
  })

  it('whitelists signed payload fields even when callers supply upstream details', () => {
    const unsafeInput = {
      attemptId: 'attempt-1',
      agentId: 'agent-1',
      expiresAt: '2026-07-28T12:05:00.000Z',
      debugUrl: 'https://steel.example/session/1',
      steelSessionId: 'steel-session-1',
    }

    const issued = createViewerBootstrapToken(unsafeInput, signingKey)
    const sessionToken = createViewerSessionToken(unsafeInput, signingKey)

    expect(decodePayload(issued.token)).not.toHaveProperty('debugUrl')
    expect(decodePayload(issued.token)).not.toHaveProperty('steelSessionId')
    expect(decodePayload(sessionToken)).not.toHaveProperty('debugUrl')
    expect(decodePayload(sessionToken)).not.toHaveProperty('steelSessionId')
  })
})
