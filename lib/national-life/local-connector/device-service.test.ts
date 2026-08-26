import { describe, expect, it, vi } from 'vitest'
import { listLocalConnectorDevices, revokeLocalConnectorDevice } from './device-service'

const now = new Date('2026-08-04T18:00:00.000Z')

describe('local connector devices', () => {
  it('lists only active devices for the agent', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'device-1',
        label: 'Este computador',
        lastSeenAt: now,
        createdAt: now,
      },
    ])
    const db = { nationalLifeConnectorDevice: { findMany } } as never
    await expect(listLocalConnectorDevices(db, { agentId: 'agent-1' })).resolves.toEqual([
      {
        deviceId: 'device-1',
        label: 'Este computador',
        lastSeenAt: now.toISOString(),
        createdAt: now.toISOString(),
      },
    ])
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: 'agent-1', status: 'ACTIVE', revokedAt: null },
      }),
    )
  })

  it('revokes a device and fails its running local syncs', async () => {
    const deviceUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      nationalLifeConnectorDevice: { updateMany: deviceUpdateMany },
      nationalLifeSyncRun: { updateMany: runUpdateMany },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(
      revokeLocalConnectorDevice(db, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        now,
      }),
    ).resolves.toEqual({ deviceId: 'device-1', revokedAt: now.toISOString() })

    expect(runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          safeErrorCode: 'LOCAL_CONNECTOR_REVOKED',
        }),
      }),
    )
  })

  it('returns success when the same agent already revoked the device', async () => {
    const revokedAt = new Date('2026-08-04T17:55:00.000Z')
    const deviceUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const deviceFindFirst = vi.fn().mockResolvedValue({ revokedAt })
    const runUpdateMany = vi.fn()
    const tx = {
      nationalLifeConnectorDevice: {
        updateMany: deviceUpdateMany,
        findFirst: deviceFindFirst,
      },
      nationalLifeSyncRun: { updateMany: runUpdateMany },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(
      revokeLocalConnectorDevice(db, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        now,
      }),
    ).resolves.toEqual({ deviceId: 'device-1', revokedAt: revokedAt.toISOString() })

    expect(deviceFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'device-1',
        agentId: 'agent-1',
        status: 'REVOKED',
        revokedAt: { not: null },
      },
      select: { revokedAt: true },
    })
    expect(runUpdateMany).not.toHaveBeenCalled()
  })
})
