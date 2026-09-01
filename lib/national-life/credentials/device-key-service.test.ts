import { webcrypto } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DeviceEncryptionKeyError,
  credentialEncryptionKeyThumbprint,
  registerDeviceEncryptionKey,
} from './device-key-service'

let publicKeyJwk: JsonWebKey

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey({
    name: 'RSA-OAEP', modulusLength: 3072,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['encrypt', 'decrypt'])
  const exported = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  publicKeyJwk = {
    kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    e: exported.e, n: exported.n,
  }
})

function activeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1', agentId: 'agent-1', status: 'ACTIVE', revokedAt: null,
    encryptionKeyThumbprint: null, ...overrides,
  }
}

describe('device credential encryption key registration', () => {
  it('registers the public key only on the signed active device', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      nationalLifeConnectorDevice: {
        findFirst: vi.fn().mockResolvedValue(activeDevice()),
        updateMany,
      },
    } as never

    const result = await registerDeviceEncryptionKey(db, {
      deviceId: 'device-1', agentId: 'agent-1', publicKeyJwk,
    })

    expect(result).toEqual({
      registered: true,
      thumbprint: credentialEncryptionKeyThumbprint(result.publicKeyJwk),
      publicKeyJwk: expect.objectContaining({ kty: 'RSA', alg: 'RSA-OAEP-256' }),
    })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'device-1', agentId: 'agent-1', status: 'ACTIVE', revokedAt: null,
        encryptionKeyThumbprint: null,
      },
    }))
    expect(JSON.stringify(updateMany.mock.calls)).not.toMatch(/"d"|"p"|"q"|"dp"|"dq"|"qi"/)
  })

  it('is idempotent for the same thumbprint and rejects replacement', async () => {
    const thumbprint = credentialEncryptionKeyThumbprint({
      ...publicKeyJwk,
      alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    })
    const sameDb = {
      nationalLifeConnectorDevice: {
        findFirst: vi.fn().mockResolvedValue(activeDevice({ encryptionKeyThumbprint: thumbprint })),
        updateMany: vi.fn(),
      },
    } as never
    await expect(registerDeviceEncryptionKey(sameDb, {
      deviceId: 'device-1', agentId: 'agent-1', publicKeyJwk,
    })).resolves.toMatchObject({ registered: false, thumbprint })

    const conflictDb = {
      nationalLifeConnectorDevice: {
        findFirst: vi.fn().mockResolvedValue(activeDevice({ encryptionKeyThumbprint: 'different' })),
        updateMany: vi.fn(),
      },
    } as never
    await expect(registerDeviceEncryptionKey(conflictDb, {
      deviceId: 'device-1', agentId: 'agent-1', publicKeyJwk,
    })).rejects.toEqual(new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_CONFLICT'))
  })

  it('rejects revoked, cross-agent and private JWK input', async () => {
    const db = {
      nationalLifeConnectorDevice: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    } as never
    await expect(registerDeviceEncryptionKey(db, {
      deviceId: 'device-1', agentId: 'agent-2', publicKeyJwk,
    })).rejects.toEqual(new DeviceEncryptionKeyError('DEVICE_NOT_ACTIVE'))
    await expect(registerDeviceEncryptionKey(db, {
      deviceId: 'device-1', agentId: 'agent-1', publicKeyJwk: { ...publicKeyJwk, d: 'private' },
    })).rejects.toEqual(new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_INVALID'))
  })
})
