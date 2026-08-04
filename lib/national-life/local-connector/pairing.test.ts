import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocalConnectorPairing,
  exchangeLocalConnectorPairing,
  hashPairingCode,
  publicKeyThumbprint,
} from './pairing'
import { publicP256JwkSchema } from './contracts'

async function publicKeyJwk() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  return webcrypto.subtle.exportKey('jwk', pair.publicKey)
}

describe('local connector pairing', () => {
  it('stores only a one-way hash of the temporary code', async () => {
    const create = vi.fn().mockResolvedValue({})
    const db = { nationalLifeConnectorPairing: { create } } as never

    const result = await createLocalConnectorPairing(db, {
      agentId: 'agent-1',
      now: new Date('2026-08-04T18:00:00.000Z'),
    })

    const data = create.mock.calls[0][0].data
    expect(data.codeHash).toBe(hashPairingCode(result.code))
    expect(JSON.stringify(data)).not.toContain(result.code)
    expect(result.expiresAt.toISOString()).toBe('2026-08-04T18:05:00.000Z')
  })

  it('atomically consumes the pairing and derives agent ownership from it', async () => {
    const deviceCreate = vi.fn().mockResolvedValue({ id: 'device-1' })
    const tx = {
      nationalLifeConnectorPairing: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pair-1', agentId: 'agent-from-pairing' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      nationalLifeConnectorDevice: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: deviceCreate,
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(
      exchangeLocalConnectorPairing(db, {
        code: 'NL-secret-code',
        label: 'MacBook local',
        publicKeyJwk: await publicKeyJwk(),
        now: new Date('2026-08-04T18:01:00.000Z'),
      }),
    ).resolves.toEqual({ deviceId: 'device-1', reclaimed: false })

    expect(deviceCreate.mock.calls[0][0].data.agentId).toBe('agent-from-pairing')
    expect(tx.nationalLifeConnectorPairing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ consumedAt: null }),
      }),
    )
  })

  it('reclaims an existing device for the same agent and key', async () => {
    const jwk = publicP256JwkSchema.parse(await publicKeyJwk())
    const thumbprint = publicKeyThumbprint(jwk)
    const deviceUpdate = vi.fn().mockResolvedValue({ id: 'device-existing' })
    const tx = {
      nationalLifeConnectorPairing: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pair-1', agentId: 'agent-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      nationalLifeConnectorDevice: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'device-existing',
          agentId: 'agent-1',
          status: 'REVOKED',
          revokedAt: new Date(),
        }),
        update: deviceUpdate,
        create: vi.fn(),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(
      exchangeLocalConnectorPairing(db, {
        code: 'NL-secret-code',
        label: 'Este computador',
        publicKeyJwk: jwk,
        now: new Date('2026-08-04T18:01:00.000Z'),
      }),
    ).resolves.toEqual({ deviceId: 'device-existing', reclaimed: true })

    expect(deviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'device-existing' },
        data: expect.objectContaining({ status: 'ACTIVE', revokedAt: null }),
      }),
    )
    expect(tx.nationalLifeConnectorDevice.create).not.toHaveBeenCalled()
    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
