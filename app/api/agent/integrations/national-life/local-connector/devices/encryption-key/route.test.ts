import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  register: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () => Response.json({ error: 'NOT_AVAILABLE' }, { status: 404 }),
}))
vi.mock('@/lib/national-life/local-connector/device-signature', () => ({
  LocalConnectorSignatureError: class extends Error {
    constructor(readonly code: string) { super(code) }
  },
  verifyLocalConnectorDeviceRequest: mocks.verify,
}))
vi.mock('@/lib/national-life/credentials/device-key-service', () => ({
  DeviceEncryptionKeyError: class extends Error {
    constructor(readonly code: string) { super(code) }
  },
  registerDeviceEncryptionKey: mocks.register,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from './route'

const publicKeyJwk = {
  kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
  e: 'AQAB', n: Buffer.alloc(384, 1).toString('base64url'),
}

function request(body: unknown) {
  return new Request('https://app.keeprone.com/api/agent/integrations/national-life/local-connector/devices/encryption-key', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.verify.mockResolvedValue({ deviceId: 'device-1', agentId: 'agent-1', jti: 'jti-1' })
  mocks.register.mockResolvedValue({ registered: true, thumbprint: 'thumbprint-1' })
})

describe('POST device encryption key', () => {
  it('binds strict public key input to the signed device identity', async () => {
    const response = await POST(request({ schemaVersion: 1, publicKeyJwk }))

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.verify).toHaveBeenCalled()
    expect(mocks.register).toHaveBeenCalledWith({}, {
      deviceId: 'device-1', agentId: 'agent-1', publicKeyJwk,
    })
  })

  it.each([
    { schemaVersion: 1, publicKeyJwk: { ...publicKeyJwk, d: 'private' } },
    { schemaVersion: 1, publicKeyJwk, deviceId: 'device-2' },
  ])('rejects private fields and cross-device body identifiers', async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(mocks.verify).toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('returns the safe conflict code without replacing the key', async () => {
    const { DeviceEncryptionKeyError } = await import(
      '@/lib/national-life/credentials/device-key-service'
    )
    mocks.register.mockRejectedValue(new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_CONFLICT'))

    const response = await POST(request({ schemaVersion: 1, publicKeyJwk }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'DEVICE_ENCRYPTION_KEY_CONFLICT' })
  })
})
