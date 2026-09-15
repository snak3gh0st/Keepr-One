import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = { activeApplication: false }
  let transactionTail = Promise.resolve()

  const tx = {
    $queryRaw: vi.fn(async () => [{ id: 'case-1', assignedAgentId: 'agent-1' }]),
    illustration: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    prospect: {
      create: vi.fn(async () => ({ id: 'prospect-1' })),
    },
    insuranceCase: {
      create: vi.fn(async () => ({ id: 'case-illustration' })),
    },
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
    requireAgentModule: vi.fn(),
    getAgentScopeIds: vi.fn(),
    canAccessCase: vi.fn(() => true),
    advanceCaseCrmToSystemStage: vi.fn(),
    getOrCreateNewLeadStageId: vi.fn(async () => 'stage-new'),
    revalidatePath: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/require-agent-module', () => ({
  requireAgentModule: mocks.requireAgentModule,
}))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.getAgentScopeIds }))
vi.mock('@/lib/case-access', () => ({ canAccessCase: mocks.canAccessCase }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: vi.fn(async () => ({
    language: 'PT',
    copy: (portuguese: string) => portuguese,
  })),
}))
vi.mock('@/lib/crm', () => ({
  CrmDomainError: class CrmDomainError extends Error {},
  cancelFollowUp: vi.fn(),
  completeFollowUp: vi.fn(),
  advanceCaseCrmToSystemStage: mocks.advanceCaseCrmToSystemStage,
  rescheduleFollowUp: vi.fn(),
  scheduleFollowUp: vi.fn(),
  parseCrmLocalDateTime: vi.fn(),
  getOrCreateNewLeadStageId: mocks.getOrCreateNewLeadStageId,
}))

import { startApplicationFromIllustration } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.activeApplication = false
  mocks.resetTransactionTail()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.requireAgentModule.mockResolvedValue({ user: { role: 'AGENT' } })
  mocks.getAgentScopeIds.mockResolvedValue(['agent-1'])
})

describe('startApplicationFromIllustration', () => {
  it('keeps Application creation closed until the later release', async () => {
    const result = await startApplicationFromIllustration('illustration-1')

    expect(result).toEqual({
      ok: false,
      message: 'Application estará disponível em uma versão futura.',
    })
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
    expect(mocks.requireAgentModule).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.illustration.updateMany).not.toHaveBeenCalled()
    expect(mocks.tx.application.create).not.toHaveBeenCalled()
  })
})
