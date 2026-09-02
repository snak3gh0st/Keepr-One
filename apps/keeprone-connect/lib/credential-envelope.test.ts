import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openSealedCredentialLease } from './credential-envelope'

describe('credential envelope parser', () => {
  it('rejects malformed and plaintext-bearing envelopes before decryption', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const pair = await webcrypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 3072,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      false,
      ['encrypt', 'decrypt'],
    ) as CryptoKeyPair

    await expect(openSealedCredentialLease({
      schemaVersion: 1,
      leaseId: 'lease_1',
      expiresAt: '2026-09-01T18:01:00.000Z',
      operation: { kind: 'SYNC_RUN', id: 'run_1', authEpoch: 1 },
      keyAlgorithm: 'RSA-OAEP-256',
      contentAlgorithm: 'AES-256-GCM',
      wrappedKey: 'a',
      iv: 'a',
      ciphertext: 'a',
      password: 'must-never-be-accepted',
    }, pair.privateKey, {
      operation: { kind: 'SYNC_RUN', id: 'run_1', authEpoch: 1 },
      now: new Date('2026-09-01T18:00:00.000Z'),
    })).rejects.toThrow('CREDENTIAL_LEASE_INVALID')
  })
})
