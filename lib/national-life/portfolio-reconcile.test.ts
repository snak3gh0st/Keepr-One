import { describe, expect, it } from 'vitest'
import { reconcileInforceRows, type InforceRow } from './portfolio-reconcile'

function row(overrides: Partial<InforceRow>): InforceRow {
  return {
    deploymentScope: 'LOCAL_CONNECTOR',
    policyNumber: 'LS1',
    policyStatus: 'Active',
    policyIssueDate: '06/02/2023',
    productName: 'Indexed Universal Life',
    insuredClientName: 'ENRICO ABDALLA',
    insuredDob: null,
    insuredEmail: null,
    insuredPhoneNumber: null,
    insuredZipcode: null,
    ownerClientName: 'ENRICO ABDALLA',
    anticipatedAnnualPremium: null,
    ...overrides,
  }
}

describe('reconcileInforceRows', () => {
  it('takes premium from the export slice and date of birth from the legacy slice', () => {
    const { policies } = reconcileInforceRows([
      row({ deploymentScope: 'LOCAL_CONNECTOR', anticipatedAnnualPremium: '1200.00' }),
      row({ deploymentScope: 'keepr-one-production-v1', insuredDob: '01/15/1980' }),
    ])

    expect(policies).toHaveLength(1)
    expect(policies[0]?.premium).toBe(1200)
    expect(policies[0]?.insuredDateOfBirth).toEqual(new Date(Date.UTC(1980, 0, 15)))
  })

  it('treats any scope other than LOCAL_CONNECTOR as the legacy grid slice', () => {
    const { policies } = reconcileInforceRows([
      row({ deploymentScope: 'some-future-deployment', insuredDob: '01/15/1980' }),
      row({ deploymentScope: 'LOCAL_CONNECTOR', anticipatedAnnualPremium: '900' }),
    ])

    expect(policies[0]?.premium).toBe(900)
    expect(policies[0]?.insuredDateOfBirth).toEqual(new Date(Date.UTC(1980, 0, 15)))
  })

  it('discards the export footer rows instead of ingesting them as policies', () => {
    const { policies, discarded } = reconcileInforceRows([
      row({ policyNumber: '', policyStatus: 'Exported On: 08/17/2026' }),
      row({ policyNumber: 'LS1' }),
    ])

    expect(policies.map((p) => p.policyNumber)).toEqual(['LS1'])
    expect(discarded).toEqual([{ reason: 'MISSING_POLICY_NUMBER', policyStatus: 'Exported On: 08/17/2026' }])
  })

  it('maps carrier statuses to the enum while keeping the carrier string', () => {
    const { policies } = reconcileInforceRows([row({ policyStatus: 'Pending Lapse' })])

    expect(policies[0]?.status).toBe('INFORCE')
    expect(policies[0]?.sourceStatus).toBe('Pending Lapse')
  })

  it('maps every status the live book contains', () => {
    const cases: [string, string][] = [
      ['Active', 'INFORCE'],
      ['Issued', 'APPROVED'],
      ['Pending Lapse', 'INFORCE'],
      ['Lapsed', 'LAPSED'],
      ['Not Active', 'CANCELLED'],
    ]
    for (const [carrier, expected] of cases) {
      const { policies } = reconcileInforceRows([row({ policyStatus: carrier })])
      expect(policies[0]?.status, carrier).toBe(expected)
    }
  })

  it('never invents a premium or a date of birth that no slice carried', () => {
    const { policies } = reconcileInforceRows([row({})])

    expect(policies[0]?.premium).toBeNull()
    expect(policies[0]?.insuredDateOfBirth).toBeNull()
  })
})
