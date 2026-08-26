import { describe, expect, it, vi } from 'vitest'
import { recordLocalConnectorAuthState } from './auth-notification-service'

const now = new Date('2026-08-26T15:00:00.000Z')

function database() {
  const findFirst = vi.fn().mockResolvedValue({
    id: 'run-1',
    agent: { userId: 'user-1' },
  })
  const upsert = vi.fn().mockResolvedValue({ id: 'notification-1' })
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const tx = {
    nationalLifeSyncRun: { findFirst },
    notification: { upsert, updateMany },
  }
  return {
    db: {
      ...tx,
      $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx),
    } as never,
    findFirst,
    upsert,
    updateMany,
  }
}

describe('local connector authentication notification', () => {
  it('creates one reopenable notification without receiving carrier credentials', async () => {
    const { db, findFirst, upsert } = database()

    await expect(recordLocalConnectorAuthState(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      state: 'REQUIRED',
      now,
    })).resolves.toEqual({ runId: 'run-1', authState: 'REQUIRED' })

    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'run-1',
        agentId: 'agent-1',
        connectorDeviceId: 'device-1',
        executionSource: 'LOCAL',
        provider: 'NATIONAL_LIFE',
        state: 'RUNNING',
      }),
      select: { id: true, agent: { select: { userId: true } } },
    })
    expect(upsert).toHaveBeenCalledWith({
      where: { dedupeKey: 'national-life-login-required:run-1' },
      create: expect.objectContaining({
        recipientUserId: 'user-1',
        type: 'NATIONAL_LIFE_LOGIN_REQUIRED',
        href: '/agent/integrations/national-life',
        dedupeKey: 'national-life-login-required:run-1',
      }),
      update: { readAt: null, createdAt: now },
    })
    expect(JSON.stringify(upsert.mock.calls)).not.toMatch(/password|cookie|mfa|token/i)
  })

  it('marks the matching warning read after the carrier session is restored', async () => {
    const { db, updateMany } = database()

    await recordLocalConnectorAuthState(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      state: 'RESTORED',
      now,
    })

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: 'user-1',
        dedupeKey: 'national-life-login-required:run-1',
        readAt: null,
      },
      data: { readAt: now },
    })
  })
})
