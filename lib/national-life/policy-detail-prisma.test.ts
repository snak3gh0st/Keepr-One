import { describe, expect, it, vi } from 'vitest'
import type { NationalLifePolicyDetail } from './policy-detail'
import { createPrismaPolicyDetailRepository } from './policy-detail-prisma'

const detail: NationalLifePolicyDetail = {
  policyNumber: 'LS1473219',
  sourcePath: '/agent/book-of-business/inforce-book/all-clients/policy-details?id=8ce782767315466db3ff440e6a8d5576',
  observedAt: new Date('2026-08-26T15:30:43.000Z'),
  coverageCaptured: true,
  paymentsCaptured: true,
  totalFaceAmount: '133000.00',
  netDeathBenefit: '133000.00',
  nextScheduledPaymentDate: new Date('2026-09-10T00:00:00.000Z'),
  paymentFrequency: 'Monthly',
  plannedPeriodicPayment: '200.00',
  anticipatedAnnualPremium: '2400.00',
  minimumMonthlyPremium: '89.49',
  minimumGuaranteedPremium: '108.14',
  ctp: '2386.02',
  mecLimit: '29461.28',
  mecLimitThrough: new Date('2027-06-10T00:00:00.000Z'),
  guidelinePremiumLimit: '41760.60',
  guidelinePremiumLimitThrough: new Date('2027-06-10T00:00:00.000Z'),
}

function database(existingObservedAt: Date | null = null) {
  const tx = {
    nationalLifePolicyDetailSnapshot: {
      findUnique: vi.fn(async () => existingObservedAt ? { observedAt: existingObservedAt } : null),
      upsert: vi.fn(async () => ({})),
    },
    policy: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }
  return {
    tx,
    db: {
      policy: {
        findFirst: vi.fn(async () => ({ id: 'policy_1', policyNumber: 'LS1473219' })),
      },
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<void>) => operation(tx)),
    },
  }
}

describe('Prisma policy detail repository', () => {
  it('upserts the typed snapshot and promotes the exact policy fields atomically', async () => {
    const { db, tx } = database()
    const repository = createPrismaPolicyDetailRepository(db as never)

    await repository.persist({
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
      policyPatch: {
        faceAmount: '133000.00',
        faceAmountSource: 'NATIONAL_LIFE_POLICY_DETAIL',
        carrierDetailUpdatedAt: detail.observedAt,
      },
    })

    expect(tx.nationalLifePolicyDetailSnapshot.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { policyId: 'policy_1' },
      create: expect.objectContaining({
        agentId: 'agent_1',
        policyId: 'policy_1',
        totalFaceAmount: '133000.00',
        raw: undefined,
      }),
      update: expect.objectContaining({
        observedAt: detail.observedAt,
        anticipatedAnnualPremium: '2400.00',
      }),
    }))
    expect(tx.policy.updateMany).toHaveBeenCalledWith({
      where: { id: 'policy_1', agentId: 'agent_1' },
      data: expect.objectContaining({
        faceAmount: '133000.00',
        carrierDetailUpdatedAt: detail.observedAt,
      }),
    })
  })

  it('does not let an older observation overwrite a newer carrier snapshot', async () => {
    const { db, tx } = database(new Date('2026-08-27T00:00:00.000Z'))
    const repository = createPrismaPolicyDetailRepository(db as never)

    await repository.persist({
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
      policyPatch: { carrierDetailUpdatedAt: detail.observedAt },
    })

    expect(tx.nationalLifePolicyDetailSnapshot.upsert).not.toHaveBeenCalled()
    expect(tx.policy.updateMany).not.toHaveBeenCalled()
  })
})
