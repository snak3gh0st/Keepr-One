import { describe, expect, it, vi } from 'vitest'
import { createPrismaLocalConnectorCommandDispatchRepository } from './command-dispatch-prisma'

const now = new Date('2026-08-26T17:00:00.000Z')

function command(deviceId: string | null) {
  return {
    id: 'cmd_1',
    agentId: 'agent_1',
    deviceId,
    protocolVersion: 1,
    runId: 'run_1',
    capability: 'READ_POLICY_DETAIL',
    target: { kind: 'POLICY', id: 'policy_1' },
    params: {
      policyNumber: 'LS1473219',
      navigatePath: '/agent/book-of-business/inforce-book/all-clients/policy-details?id=a73f1af893a94906b965e68d11db807b',
    },
    payloadHash: 'a'.repeat(64),
    idempotencyKey: 'policy_1:detail:1',
    requiresConfirmation: false,
    confirmationState: 'NOT_REQUIRED',
    state: 'QUEUED',
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    events: [{ sequence: 0 }],
  }
}

function database(findFirstResults: unknown[], updateCount = 1) {
  const model = {
    findFirst: vi.fn(async () => findFirstResults.shift() ?? null),
    findUnique: vi.fn(async () => null),
    create: vi.fn(),
    updateMany: vi.fn(async () => ({ count: updateCount })),
  }
  const db = {
    nationalLifeConnectorCommand: model,
    nationalLifeConnectorCommandEvent: { create: vi.fn() },
    nationalLifeConnectorCommandConfirmation: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
  }
  return { db, model }
}

describe('Prisma local connector command dispatch repository', () => {
  it('returns an existing command already owned by the same device before claiming another', async () => {
    const owned = command('device_1')
    const { db, model } = database([owned])
    const repository = createPrismaLocalConnectorCommandDispatchRepository(db as never)

    await expect(repository.claimNext({ agentId: 'agent_1', deviceId: 'device_1', now }))
      .resolves.toEqual(owned)
    expect(model.updateMany).not.toHaveBeenCalled()
  })

  it('atomically assigns an eligible unbound command and rereads exact ownership', async () => {
    const unbound = command(null)
    const owned = command('device_1')
    const { db, model } = database([null, unbound, owned])
    const repository = createPrismaLocalConnectorCommandDispatchRepository(db as never)

    await expect(repository.claimNext({ agentId: 'agent_1', deviceId: 'device_1', now }))
      .resolves.toEqual(owned)
    expect(model.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'cmd_1', agentId: 'agent_1', deviceId: null, state: 'QUEUED' }),
      data: { deviceId: 'device_1' },
    }))
    expect(model.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        createdAt: { lte: new Date(now.getTime() - 15_000) },
      }),
    }))
  })

  it('lets the browser that requested an exact command claim it immediately', async () => {
    const unbound = command(null)
    const owned = command('device_1')
    const { db, model } = database([null, unbound, owned])
    const repository = createPrismaLocalConnectorCommandDispatchRepository(db as never)

    await expect(repository.claimNext({
      agentId: 'agent_1',
      deviceId: 'device_1',
      commandId: 'cmd_1',
      now,
    })).resolves.toEqual(owned)
    expect(model.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.not.objectContaining({ createdAt: expect.anything() }),
    }))
  })

  it('returns no command when another device wins the assignment race', async () => {
    const { db } = database([null, command(null)], 0)
    const repository = createPrismaLocalConnectorCommandDispatchRepository(db as never)

    await expect(repository.claimNext({ agentId: 'agent_1', deviceId: 'device_1', now }))
      .resolves.toBeNull()
  })
})
