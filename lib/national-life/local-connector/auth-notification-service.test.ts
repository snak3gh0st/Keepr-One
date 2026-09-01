import { describe, expect, it, vi } from 'vitest'
import { recordLocalConnectorAuthState } from './auth-notification-service'

const now = new Date('2026-08-26T15:00:00.000Z')

function database(initial: { authState?: string; authEpoch?: number; authRequiredAt?: Date | null } = {}) {
  const run = {
    id: 'run-1',
    authState: initial.authState ?? 'READY',
    authEpoch: initial.authEpoch ?? 0,
    authRequiredAt: initial.authRequiredAt ?? null,
    agent: { userId: 'user-1' },
  }
  const findFirst = vi.fn().mockImplementation(async () => ({ ...run }))
  const runUpdateMany = vi.fn().mockImplementation(async ({ data }) => {
    Object.assign(run, data)
    return { count: 1 }
  })
  const upsert = vi.fn().mockResolvedValue({ id: 'notification-1' })
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const tx = {
    nationalLifeSyncRun: { findFirst, updateMany: runUpdateMany },
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
    runUpdateMany,
    run,
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
    })).resolves.toEqual({ runId: 'run-1', authState: 'REQUIRED', authEpoch: 1 })

    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'run-1',
        agentId: 'agent-1',
        connectorDeviceId: 'device-1',
        executionSource: 'LOCAL',
        provider: 'NATIONAL_LIFE',
        state: 'RUNNING',
      }),
      select: {
        id: true,
        authState: true,
        authEpoch: true,
        authRequiredAt: true,
        agent: { select: { userId: true } },
      },
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

  it('increments once per authentication episode and keeps MFA on that epoch', async () => {
    const { db, run } = database()

    await recordLocalConnectorAuthState(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', state: 'REQUIRED', now,
    })
    await recordLocalConnectorAuthState(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', state: 'REQUIRED',
      now: new Date(now.getTime() + 1_000),
    })
    await expect(recordLocalConnectorAuthState(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', state: 'MFA_REQUIRED',
      now: new Date(now.getTime() + 2_000),
    })).resolves.toMatchObject({ authState: 'MFA_REQUIRED', authEpoch: 1 })
    await recordLocalConnectorAuthState(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', state: 'RESTORED',
      now: new Date(now.getTime() + 3_000),
    })
    await expect(recordLocalConnectorAuthState(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', state: 'REQUIRED',
      now: new Date(now.getTime() + 4_000),
    })).resolves.toMatchObject({ authState: 'REQUIRED', authEpoch: 2 })

    expect(run).toMatchObject({ authState: 'REQUIRED', authEpoch: 2 })
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
        readAt: null,
        OR: [
          { dedupeKey: 'national-life-login-required:run-1' },
          { dedupeKey: { startsWith: 'national-life-mfa-required:run-1:' } },
        ],
      },
      data: { readAt: now },
    })
  })
})
