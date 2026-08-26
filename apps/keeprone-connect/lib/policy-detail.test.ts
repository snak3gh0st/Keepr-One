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

  it('verifies the expected visible policy number without returning nearby content', () => {
    expect(policyNumberIsVisible(coverageFixture, 'ls 1473219')).toBe(true)
    expect(policyNumberIsVisible(coverageFixture, 'LS0000000')).toBe(false)
    expect(policyNumberIsVisible('Policy Number\nLS14732190', 'LS1473219')).toBe(false)
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
