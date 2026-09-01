import { describe, expect, it } from 'vitest'
import {
  parseCredentialBinding,
  parseCredentialLeaseRequest,
  parseCredentialLeaseResult,
  parseCredentialPlaintext,
  parseSealedCredentialLease,
} from './contracts'

const request = {
  schemaVersion: 1,
  operation: { kind: 'SYNC_RUN', id: 'run_1' },
  page: {
    origin: 'https://www.nationallife.com',
    pathname: '/agent/auth/login',
    classification: 'LOGIN',
  },
} as const

describe('credential broker contracts', () => {
  it('accepts only the closed login-page lease request', () => {
    expect(parseCredentialLeaseRequest(request)).toEqual(request)
    expect(parseCredentialLeaseRequest({ ...request, password: 'never' })).toBeNull()
    expect(parseCredentialLeaseRequest({
      ...request,
      page: { ...request.page, origin: 'https://nationallife.example.net' },
    })).toBeNull()
    expect(parseCredentialLeaseRequest({
      ...request,
      operation: { ...request.operation, id: 'x'.repeat(129) },
    })).toBeNull()
  })

  it('accepts only redacted lease outcomes', () => {
    expect(parseCredentialLeaseResult({ schemaVersion: 1, outcome: 'MFA_REQUIRED' })).toEqual({
      schemaVersion: 1,
      outcome: 'MFA_REQUIRED',
    })
    expect(parseCredentialLeaseResult({ schemaVersion: 1, outcome: 'OTP_SUBMITTED' })).toBeNull()
    expect(parseCredentialLeaseResult({
      schemaVersion: 1,
      outcome: 'AUTHENTICATED',
      username: 'must-not-cross-the-boundary',
    })).toBeNull()
  })

  it('validates plaintext only at the encryption boundary', () => {
    expect(parseCredentialPlaintext({
      formatVersion: 1,
      username: 'agent@example.com',
      password: 'not-a-real-secret',
    })).toEqual({
      formatVersion: 1,
      username: 'agent@example.com',
      password: 'not-a-real-secret',
    })
    expect(parseCredentialPlaintext({
      formatVersion: 1,
      username: 'agent@example.com',
      password: '',
    })).toBeNull()
    expect(parseCredentialPlaintext({
      formatVersion: 1,
      username: 'agent@example.com',
      password: 'x'.repeat(257),
    })).toBeNull()
  })

  it('binds Vault ciphertext to one agent and one purpose', () => {
    const binding = {
      agentId: 'agent_1',
      formatVersion: 1,
      provider: 'NATIONAL_LIFE',
      purpose: 'PORTAL_CREDENTIAL',
    } as const
    expect(parseCredentialBinding(binding)).toEqual(binding)
    expect(parseCredentialBinding({ ...binding, purpose: 'SESSION_COOKIE' })).toBeNull()
  })

  it('accepts a strict sealed envelope and rejects plaintext additions', () => {
    const lease = {
      schemaVersion: 1,
      leaseId: 'lease_1',
      expiresAt: '2026-09-01T17:01:00.000Z',
      operation: { kind: 'CONNECTOR_COMMAND', id: 'command_1', authEpoch: 2 },
      keyAlgorithm: 'RSA-OAEP-256',
      contentAlgorithm: 'AES-256-GCM',
      wrappedKey: Buffer.alloc(384, 2).toString('base64url'),
      iv: Buffer.alloc(12, 3).toString('base64url'),
      ciphertext: Buffer.alloc(32, 4).toString('base64url'),
    } as const
    expect(parseSealedCredentialLease(lease)).toEqual(lease)
    expect(parseSealedCredentialLease({ ...lease, password: 'never' })).toBeNull()
    expect(parseSealedCredentialLease({
      ...lease,
      operation: { ...lease.operation, authEpoch: -1 },
    })).toBeNull()
  })
})
