import { describe, expect, it } from 'vitest'
import type { ClientSummary } from './client-summary'
import { analyzeClientPolicy } from './client-summary-insights'

const projected: ClientSummary = {
  kind: 'PROJECTED', insuredName: 'Test', productLabel: 'FlexLife',
  faceAmount: 500_000, monthlyPremium: 100, annualPremium: 1_200,
  issuedOn: new Date('2026-09-01T00:00:00Z'), advisorName: null,
  coverage: [
    { policyYear: 1, age: 40, premiumOutlay: 1_200, cashSurrenderValue: 0, netDeathBenefit: 500_000, accumulatedValue: 900 },
    { policyYear: 2, age: 41, premiumOutlay: 1_200, cashSurrenderValue: 1_500, netDeathBenefit: 505_000, accumulatedValue: 2_100 },
    { policyYear: 3, age: 42, premiumOutlay: 1_200, cashSurrenderValue: 3_800, netDeathBenefit: 510_000, accumulatedValue: 4_000 },
  ],
  milestones: [], fullMilestones: [], outlook: null, lapseYear: null, mecYear: null,
  guaranteed: [], guaranteedLapse: null, scenarios: null,
}

describe('client policy intelligence', () => {
  it('finds the first year surrender value reaches cumulative premiums', () => {
    const result = analyzeClientPolicy(projected)
    expect(result?.breakEven).toMatchObject({
      policyYear: 3, age: 42, premiumOutlay: 1_200, totalPaid: 3_600,
      cashSurrenderValue: 3_800, surrenderDifference: 200,
    })
    expect(result?.contributionBasis).toBe('ANNUAL_LEDGER')
  })

  it('uses the confirmed level premium for sparse carrier milestones', () => {
    const result = analyzeClientPolicy({ ...projected, coverage: [projected.coverage[0]!, projected.coverage[2]!] })
    expect(result?.dataIsAnnual).toBe(false)
    expect(result?.contributionBasis).toBe('CONFIRMED_LEVEL_PREMIUM')
    expect(result?.breakEvenWindow).toEqual({ afterYear: 1, byYear: 3 })
    expect(result?.breakEven?.totalPaid).toBe(3_600)
  })
})
