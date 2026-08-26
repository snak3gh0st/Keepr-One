import { describe, expect, it, vi } from 'vitest'
import type { NationalLifePolicyDetail } from './policy-detail'
import {
  persistNationalLifePolicyDetail,
  type PolicyDetailRepository,
} from './policy-detail-service'

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

function repository(policy: { id: string; policyNumber: string } | null = { id: 'policy_1', policyNumber: 'LS1473219' }) {
  return {
    findOwnedPolicy: vi.fn(async (input: Parameters<PolicyDetailRepository['findOwnedPolicy']>[0]) => {
      void input
      return policy
    }),
    persist: vi.fn(async (input: Parameters<PolicyDetailRepository['persist']>[0]) => {
      void input
    }),
  } satisfies PolicyDetailRepository
}

describe('persistNationalLifePolicyDetail', () => {
  it('promotes carrier coverage/payment values with field-level provenance', async () => {
    const repo = repository()

    await persistNationalLifePolicyDetail(repo, {
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
    })

    expect(repo.persist).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      policyPatch: {
        faceAmount: '133000.00',
        faceAmountSource: 'NATIONAL_LIFE_POLICY_DETAIL',
        carrierDetailUpdatedAt: detail.observedAt,
      },
      detail,
    }))
  })

  it('does not erase known policy values when the carrier detail omits a field', async () => {
    const repo = repository()

    await persistNationalLifePolicyDetail(repo, {
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail: {
        ...detail,
        totalFaceAmount: null,
        plannedPeriodicPayment: null,
        paymentFrequency: null,
      },
    })

    expect(repo.persist.mock.calls[0]?.[0].policyPatch).toEqual({
      carrierDetailUpdatedAt: detail.observedAt,
    })
  })

  it('rejects a policy outside the agent scope', async () => {
    const repo = repository(null)

    await expect(persistNationalLifePolicyDetail(repo, {
      agentId: 'agent_2',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
    })).rejects.toThrowError('POLICY_DETAIL_NOT_FOUND')

    expect(repo.persist).not.toHaveBeenCalled()
  })

  it('rejects a carrier detail for a different policy number', async () => {
    const repo = repository({ id: 'policy_1', policyNumber: 'LS9999999' })

    await expect(persistNationalLifePolicyDetail(repo, {
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
    })).rejects.toThrowError('POLICY_DETAIL_TARGET_MISMATCH')

    expect(repo.persist).not.toHaveBeenCalled()
  })

  it('passes the typed snapshot through idempotently for repository upsert', async () => {
    const repo = repository()
    const input = {
      agentId: 'agent_1',
      deploymentScope: 'LOCAL_CONNECTOR',
      policyId: 'policy_1',
      detail,
    }

    await persistNationalLifePolicyDetail(repo, input)
    await persistNationalLifePolicyDetail(repo, input)

    expect(repo.persist).toHaveBeenCalledTimes(2)
    expect(repo.persist.mock.calls[0]?.[0]).toEqual(repo.persist.mock.calls[1]?.[0])
  })
})
