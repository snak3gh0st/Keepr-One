import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openSealedCredentialLease } from '../../../apps/keeprone-connect/lib/credential-envelope'
import { sealCredentialForDevice } from './sealed-envelope'

const operation = {
  kind: 'SYNC_RUN' as const,
  id: 'run_1',
  authEpoch: 3,
}
const now = new Date('2026-09-01T18:00:00.000Z')
const expiresAt = new Date(now.getTime() + 60_000)

async function keyPair() {
  return webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    false,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKeyPair>
}

async function publicJwk(pair: CryptoKeyPair) {
  const exported = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    kty: 'RSA',
    alg: 'RSA-OAEP-256',
    use: 'enc',
    key_ops: ['encrypt'],
    ext: true,
    e: exported.e,
    n: exported.n,
  }
}

describe('sealed credential lease envelope', () => {
  it('round-trips exactly between the server sealer and extension opener', async () => {
    const pair = await keyPair()
    const sealed = await sealCredentialForDevice({
      credential: { formatVersion: 1, username: 'sentinel-user', password: 'sentinel-pass' },
      publicKeyJwk: await publicJwk(pair),
      leaseId: 'lease_1',
      expiresAt,
      operation,
    })

    expect(JSON.stringify(sealed)).not.toMatch(/sentinel-user|sentinel-pass|password|username/)
    await expect(openSealedCredentialLease(sealed, pair.privateKey, {
      operation,
      now,
    })).resolves.toEqual({
      formatVersion: 1,
      username: 'sentinel-user',
      password: 'sentinel-pass',
    })
  })

  it.each([
    ['operation id', { operation: { ...operation, id: 'run_2' } }],
    ['auth epoch', { operation: { ...operation, authEpoch: 4 } }],
    ['expiry', { now: new Date(expiresAt.getTime() + 1) }],
  ])('refuses a modified %s binding before exposing plaintext', async (_label, override) => {
    const pair = await keyPair()
    const sealed = await sealCredentialForDevice({
      credential: { formatVersion: 1, username: 'sentinel-user', password: 'sentinel-pass' },
      publicKeyJwk: await publicJwk(pair),
      leaseId: 'lease_1',
      expiresAt,
      operation,
    })

    await expect(openSealedCredentialLease(sealed, pair.privateKey, {
      operation,
      now,
      ...override,
    })).rejects.toThrow('CREDENTIAL_LEASE_INVALID')
  })

  it('refuses another device key and ciphertext tampering', async () => {
    const pair = await keyPair()
    const anotherPair = await keyPair()
    const sealed = await sealCredentialForDevice({
      credential: { formatVersion: 1, username: 'sentinel-user', password: 'sentinel-pass' },
      publicKeyJwk: await publicJwk(pair),
      leaseId: 'lease_1',
      expiresAt,
      operation,
    })

    await expect(openSealedCredentialLease(sealed, anotherPair.privateKey, {
      operation,
      now,
    })).rejects.toThrow('CREDENTIAL_LEASE_INVALID')

    const final = sealed.ciphertext.at(-1) === 'A' ? 'B' : 'A'
    await expect(openSealedCredentialLease({
      ...sealed,
      ciphertext: sealed.ciphertext.slice(0, -1) + final,
    }, pair.privateKey, { operation, now })).rejects.toThrow('CREDENTIAL_LEASE_INVALID')
  })
})
