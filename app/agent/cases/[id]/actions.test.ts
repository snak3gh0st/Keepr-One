import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = { activeApplication: false }
  let transactionTail = Promise.resolve()

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'case-1', assignedAgentId: 'agent-1' }]),
    application: {
      findFirst: vi.fn(async () => state.activeApplication ? { id: 'application-1' } : null),
      create: vi.fn(async () => {
        state.activeApplication = true
        return { id: 'application-1' }
      }),
    },
    caseTimelineEvent: { create: vi.fn(async () => ({ id: 'timeline-1' })) },
  }

  return {
    state,
    tx,
    resetTransactionTail() { transactionTail = Promise.resolve() },
    transaction: vi.fn(<T>(callback: (transaction: typeof tx) => Promise<T>) => {
      const result = transactionTail.then(() => callback(tx))
      transactionTail = result.then(() => undefined, () => undefined)
      return result
    }),
    getCurrentAgent: vi.fn(),
    findAgents: vi.fn(),
    advanceCaseCrmToSystemStage: vi.fn(),
    revalidatePath: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findMany: mocks.findAgents },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/case-access', () => ({ canAccessCase: vi.fn(() => true) }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/crm', () => ({
  CrmDomainError: class CrmDomainError extends Error {},
  cancelFollowUp: vi.fn(),
  completeFollowUp: vi.fn(),
  advanceCaseCrmToSystemStage: mocks.advanceCaseCrmToSystemStage,
  rescheduleFollowUp: vi.fn(),
  scheduleFollowUp: vi.fn(),
  parseCrmLocalDateTime: vi.fn(),
}))

import { startApplication } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.activeApplication = false
  mocks.resetTransactionTail()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findAgents.mockResolvedValue([{ id: 'agent-1', parentAgentId: null }])
})

describe('startApplication', () => {
  it('serializes concurrent starts and creates a single active application', async () => {
    const [first, second] = await Promise.all([
      startApplication('case-1'),
      startApplication('case-1'),
    ])

    expect([first, second]).toContainEqual({ ok: true })
    expect([first, second]).toContainEqual({
      ok: false,
      message: 'Já existe uma aplicação em andamento para este caso.',
    })
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2)
    expect(mocks.tx.application.findFirst).toHaveBeenCalledTimes(2)
    expect(mocks.tx.application.create).toHaveBeenCalledTimes(1)
    expect(mocks.tx.caseTimelineEvent.create).toHaveBeenCalledTimes(1)
    expect(mocks.advanceCaseCrmToSystemStage).toHaveBeenCalledTimes(1)
  })
})
