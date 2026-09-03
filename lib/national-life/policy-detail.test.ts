import { describe, expect, it } from 'vitest'
import { parseNationalLifePolicyDetail } from './policy-detail'

const PATH = '/agent/book-of-business/inforce-book/all-clients/policy-details?id=8ce782767315466db3ff440e6a8d5576'

function observation(overrides: Partial<Parameters<typeof parseNationalLifePolicyDetail>[0]> = {}) {
  return {
    navigatePath: PATH,
    expectedPolicyNumber: 'LS1473219',
    visiblePolicyNumber: 'LS1473219',
    observedAt: '2026-08-26T15:30:43.000Z',
    fields: [
      { section: 'COVERAGE' as const, label: 'Total Face Amount', value: '$133,000.00' },
      { section: 'COVERAGE' as const, label: 'Net Death Benefit', value: '$133,000.00' },
      { section: 'COVERAGE' as const, label: 'MEC Limit', value: '$29,461.28 through 06/10/2027' },
      { section: 'COVERAGE' as const, label: 'Guideline Premium Limit', value: '$41,760.60 through 06/10/2027' },
      { section: 'PAYMENTS' as const, label: 'Next Scheduled Payment Date', value: '09/10/2026' },
      { section: 'PAYMENTS' as const, label: 'Payment Frequency', value: 'Monthly' },
      { section: 'PAYMENTS' as const, label: 'Planned Periodic Payment', value: '$200.00' },
      { section: 'PAYMENTS' as const, label: 'Anticipated Annual Premium', value: '$2,400.00' },
      { section: 'PAYMENTS' as const, label: 'Minimum Monthly Premium', value: '$89.49' },
      { section: 'PAYMENTS' as const, label: 'Minimum Guaranteed Premium', value: '$108.14' },
      { section: 'PAYMENTS' as const, label: 'CTP', value: '$2,386.02' },
    ],
    ...overrides,
  }
}

describe('parseNationalLifePolicyDetail', () => {
  it('normalizes the coverage and payment values observed on the live carrier detail', () => {
    expect(parseNationalLifePolicyDetail(observation())).toEqual({
      policyNumber: 'LS1473219',
      sourcePath: PATH,
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
    })
  })

  it('keeps carrier omissions unknown instead of turning them into zero', () => {
    const result = parseNationalLifePolicyDetail(observation({
      fields: [
        { section: 'COVERAGE', label: 'Total Face Amount', value: '—' },
        { section: 'PAYMENTS', label: 'Planned Periodic Payment', value: '' },
      ],
    }))

    expect(result.totalFaceAmount).toBeNull()
    expect(result.plannedPeriodicPayment).toBeNull()
    expect(result.anticipatedAnnualPremium).toBeNull()
  })

  it('uses the National Life Base Face Amount label for Term policies', () => {
    const result = parseNationalLifePolicyDetail(observation({
      fields: [
        { section: 'COVERAGE', label: 'Base Face Amount', value: '$500,000.00' },
        { section: 'PAYMENTS', label: 'CTP', value: '$1,125.00' },
      ],
    }))

    expect(result.totalFaceAmount).toBe('500000.00')
    expect(result.ctp).toBe('1125.00')
  })

  it('rejects a path outside the exact policy-detail route', () => {
    expect(() => parseNationalLifePolicyDetail(observation({
      navigatePath: '/agent/book-of-business/inforce-book/all-clients',
    }))).toThrowError('POLICY_DETAIL_PATH_INVALID')
  })

  it('rejects a page whose visible policy is not the approved target', () => {
    expect(() => parseNationalLifePolicyDetail(observation({
      visiblePolicyNumber: 'LS0000000',
    }))).toThrowError('POLICY_DETAIL_TARGET_MISMATCH')
  })

  it('rejects malformed carrier money instead of persisting a partial number', () => {
    expect(() => parseNationalLifePolicyDetail(observation({
      fields: [{ section: 'COVERAGE', label: 'Total Face Amount', value: '$13X,000.00' }],
    }))).toThrowError('POLICY_DETAIL_VALUE_INVALID')
  })

  it('rejects conflicting duplicate labels', () => {
    expect(() => parseNationalLifePolicyDetail(observation({
      fields: [
        { section: 'PAYMENTS', label: 'CTP', value: '$2,386.02' },
        { section: 'PAYMENTS', label: 'CTP', value: '$2,500.00' },
      ],
    }))).toThrowError('POLICY_DETAIL_VALUE_CONFLICT')
  })
})
