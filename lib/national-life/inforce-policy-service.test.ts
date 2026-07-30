import { describe, expect, it } from 'vitest'
import { toInforcePolicySnapshot, toInforcePolicySnapshots } from './inforce-policy-service'

describe('National Life inforce policy mapping', () => {
  it('maps the real inforce grid field names, which differ from the case grids', () => {
    const snapshot = toInforcePolicySnapshot({
      PolicyNumber: '<a href="/x">NL999</a>',
      PolicyStatus: 'Active',
      PolStatus: 'IF',
      InsuredClientName: 'Doe, Jane',
      InsuredDOB: '01/02/1980',
      OwnerClientName: 'Doe, Jane',
      ProductName: 'FlexLife II',
      ProductClass: 'Term',
      AccumulatedCashValue: '1234.56',
      AAP: '1500.00',
      AgentName: 'Novaes, C',
      AgentNumber: '99887',
      CompanyCode: 'NLIC',
    })

    expect(snapshot).toMatchObject({
      policyNumber: 'NL999',
      policyStatus: 'Active',
      insuredClientName: 'Doe, Jane',
      insuredDob: '01/02/1980',
      productName: 'FlexLife II',
      accumulatedCashValue: '1234.56',
      anticipatedAnnualPremium: '1500.00',
      agentName: 'Novaes, C',
      companyCode: 'NLIC',
    })
  })

  it('falls back to PolStatus when PolicyStatus is blank', () => {
    const snapshot = toInforcePolicySnapshot({
      PolicyNumber: 'NL1',
      PolicyStatus: '',
      PolStatus: 'IF',
    })
    expect(snapshot?.policyStatus).toBe('IF')
  })

  it('keeps the untouched carrier row in raw', () => {
    const row = { PolicyNumber: 'NL1', OwnerEmail: null, MultipleOwnerFlag: null }
    expect(toInforcePolicySnapshot(row)?.raw).toBe(row)
  })

  it('drops a row with no policy number', () => {
    expect(toInforcePolicySnapshot({ InsuredClientName: 'Nobody' })).toBeNull()
  })

  it('collapses a policy repeated across pages onto one snapshot', () => {
    const snapshots = toInforcePolicySnapshots([
      { PolicyNumber: 'NL1', PolicyStatus: 'Stale' },
      { PolicyNumber: 'NL1', PolicyStatus: 'Fresh' },
      { PolicyNumber: 'NL2' },
    ])
    expect(snapshots).toHaveLength(2)
    expect(snapshots.find((s) => s.policyNumber === 'NL1')?.policyStatus).toBe('Fresh')
  })
})
