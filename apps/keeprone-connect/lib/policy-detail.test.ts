import { describe, expect, it } from 'vitest'
import {
  extractApprovedPolicyDetailFields,
  policyNumberIsVisible,
} from './policy-detail'

const coverageFixture = `
  Policy Number
  LS1473219
  Insured Name
  Private Client Name
  Date of Birth
  01/02/1970
  Total Face Amount
  $250,000.00
  Net Death Benefit: $261,442.18
  MEC Limit
  $17,400.00 through 08/26/2033
  Guideline Premium Limit
  $22,100 through 08/26/2033
`

const paymentsFixture = `
  Billing contact private@example.com
  Planned Periodic Payment
  $425.00
  Payment Frequency: Monthly
  Anticipated Annual Premium
  $5,100.00
  Minimum Monthly Premium
  $218.41
  Minimum Guaranteed Premium
  $198.00
  CTP
  $190.25
  Next Scheduled Payment Date
  09/15/2026
`

const liveCarrierFixture = `
  $300,000.00
  Total Face Amount
  $300,886.86
  Net Death Benefit
  $16,724.00 through 01/10/2027
  MEC Limit
  $27,299.96 through 01/10/2027
  Guideline Premium Limit
  10/10/2026
  Next Scheduled Payment Date
  Monthly
  Payment Frequency
  $100.00
  Planned Periodic Payment
  $1,200.00
  Anticipated Annual Premium
  $35.18
  Minimum Monthly Premium
  $61.16
  Minimum Guaranteed Premium
  $975.00
  CTP
`

describe('National Life policy detail extraction', () => {
  it('extracts only approved coverage labels from a page fixture', () => {
    const fields = extractApprovedPolicyDetailFields(coverageFixture, 'COVERAGE')
    expect(fields).toEqual([
      { section: 'COVERAGE', label: 'Total Face Amount', value: '$250,000.00' },
      { section: 'COVERAGE', label: 'Net Death Benefit', value: '$261,442.18' },
      { section: 'COVERAGE', label: 'MEC Limit', value: '$17,400.00 through 08/26/2033' },
      { section: 'COVERAGE', label: 'Guideline Premium Limit', value: '$22,100 through 08/26/2033' },
    ])
    expect(JSON.stringify(fields)).not.toContain('Private Client Name')
    expect(JSON.stringify(fields)).not.toContain('01/02/1970')
  })

  it('extracts only approved payment labels and never page-wide PII', () => {
    const fields = extractApprovedPolicyDetailFields(paymentsFixture, 'PAYMENTS')
    expect(fields).toHaveLength(7)
    expect(fields).toContainEqual({
      section: 'PAYMENTS', label: 'Anticipated Annual Premium', value: '$5,100.00',
    })
    expect(JSON.stringify(fields)).not.toContain('private@example.com')
  })

  it('extracts Base Face Amount from a Term policy coverage section', () => {
    expect(extractApprovedPolicyDetailFields(
      'Policy Number\nLS1473219\nBase Face Amount\n$500,000.00',
      'COVERAGE',
    )).toContainEqual({
      section: 'COVERAGE', label: 'Base Face Amount', value: '$500,000.00',
    })
  })

  it('extracts the live carrier value-before-label layout without shifting fields', () => {
    expect(extractApprovedPolicyDetailFields(liveCarrierFixture, 'COVERAGE')).toEqual([
      { section: 'COVERAGE', label: 'Total Face Amount', value: '$300,000.00' },
      { section: 'COVERAGE', label: 'Net Death Benefit', value: '$300,886.86' },
      { section: 'COVERAGE', label: 'MEC Limit', value: '$16,724.00 through 01/10/2027' },
      { section: 'COVERAGE', label: 'Guideline Premium Limit', value: '$27,299.96 through 01/10/2027' },
    ])
    expect(extractApprovedPolicyDetailFields(liveCarrierFixture, 'PAYMENTS')).toEqual([
      { section: 'PAYMENTS', label: 'Next Scheduled Payment Date', value: '10/10/2026' },
      { section: 'PAYMENTS', label: 'Payment Frequency', value: 'Monthly' },
      { section: 'PAYMENTS', label: 'Planned Periodic Payment', value: '$100.00' },
      { section: 'PAYMENTS', label: 'Anticipated Annual Premium', value: '$1,200.00' },
      { section: 'PAYMENTS', label: 'Minimum Monthly Premium', value: '$35.18' },
      { section: 'PAYMENTS', label: 'Minimum Guaranteed Premium', value: '$61.16' },
      { section: 'PAYMENTS', label: 'CTP', value: '$975.00' },
    ])
  })

  it('verifies the expected visible policy number without returning nearby content', () => {
    expect(policyNumberIsVisible(coverageFixture, 'ls 1473219')).toBe(true)
    expect(policyNumberIsVisible(
      'Policy # LS1473219 Last Updated:9/2/2026 4:55:02 AM',
      'LS1473219',
    )).toBe(true)
    expect(policyNumberIsVisible(coverageFixture, 'LS0000000')).toBe(false)
    expect(policyNumberIsVisible('Policy Number\nLS14732190', 'LS1473219')).toBe(false)
    expect(policyNumberIsVisible(
      'Policy # LS14732190 Last Updated:9/2/2026 4:55:02 AM',
      'LS1473219',
    )).toBe(false)
  })

  it('bounds and normalizes extracted values', () => {
    expect(extractApprovedPolicyDetailFields(
      `Total Face Amount\n${'9'.repeat(300)}`,
      'COVERAGE',
    )).toEqual([])
    expect(extractApprovedPolicyDetailFields('Total Face Amount\n   $100,000   ', 'COVERAGE'))
      .toEqual([{ section: 'COVERAGE', label: 'Total Face Amount', value: '$100,000' }])
  })
})
