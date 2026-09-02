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
  mocks.getAgentScopeIds.mockResolvedValue(['agent-1'])
})

describe('startApplicationFromIllustration', () => {
  it('creates and seeds the Application directly from an official Illustration', async () => {
    mocks.tx.illustration.findFirst.mockResolvedValue({
      id: 'illustration-1',
      caseId: null,
      clientId: null,
      createdAt: new Date('2026-08-31T12:00:00.000Z'),
      productName: 'FlexLife',
      faceAmount: 250_000,
      premium: 350,
      documentFetchedAt: new Date('2026-08-31T12:05:00.000Z'),
      documentMimeType: 'application/pdf',
      documentBytes: new Uint8Array([1, 2, 3]),
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2,
          firstName: 'Ana', lastName: 'Teste', dateOfBirth: '1990-01-01', issueState: 'FL',
          gender: 'Female', rateClass: 'Standard_NT', solveBasis: 'PREMIUM',
          targetMonthlyPremium: 300, deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
        foresightResult: {
          solveBasis: 'PREMIUM', requestedAmount: 300, confirmedFaceAmount: 250_000,
          confirmedMonthlyPremium: 350, confirmedAnnualPremium: 4_200,
        },
      },
    })

    const result = await startApplicationFromIllustration('illustration-1')

    expect(result).toMatchObject({ ok: true, applicationId: 'application-1' })
    expect(mocks.tx.illustration.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'illustration-1', agentId: 'agent-1', caseId: null },
    }))
    expect(mocks.tx.application.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        intakeVersion: 2,
        dossier: expect.objectContaining({
          coverage: expect.objectContaining({
            family: 'IUL', illustrationId: 'illustration-1',
            faceAmount: 250_000, plannedPremium: 350,
          }),
        }),
      }),
    }))
    expect(mocks.advanceCaseCrmToSystemStage).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ systemKey: 'APPLICATION' }),
    )
  })
})
