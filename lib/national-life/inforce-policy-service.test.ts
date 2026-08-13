import { describe, expect, it, vi } from 'vitest'

const persistenceMocks = vi.hoisted(() => ({
  inforceUpsert: vi.fn(),
  transaction: vi.fn(),
  agentFindMany: vi.fn(),
}))

vi.mock('../prisma', () => ({
  prisma: {
    nationalLifeInforcePolicy: { upsert: persistenceMocks.inforceUpsert },
    $transaction: persistenceMocks.transaction,
    agent: { findMany: persistenceMocks.agentFindMany },
  },
}))

import {
  persistInforcePolicies,
  toInforcePolicySnapshot,
  toInforcePolicySnapshots,
} from './inforce-policy-service'

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
      TargetPremiumAmount: '1200.00',
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
      targetPremium: '1200.00',
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

  it('maps the official Inforce Client Information export headers', () => {
    expect(toInforcePolicySnapshot({
      'Policy #': 'NL-EXPORT-1',
      Owner: 'Owner Name',
      'Insured / Annuitant': 'Insured Name',
      Status: 'Active',
      Type: 'Life',
      Product: 'FlexLife',
      Agency: 'Agency Name',
      Agent: 'Agent Name',
      'Agent #': '5500',
      'Issue Date': '08/13/2026',
      'Owner Email': 'owner@example.com',
      'Owner Phone': '5551112222',
      'Owner Address Line 1': '10 Main St',
      'Owner City': 'Orlando',
      'Owner State': 'FL',
      'Owner Zipcode': '32801',
      'Anticipated Annual Premium': 2400,
      'NB Policy #': 'NB-1',
    })).toMatchObject({
      policyNumber: 'NL-EXPORT-1',
      nbPolicyNumber: 'NB-1',
      insuredClientName: 'Insured Name',
      ownerClientName: 'Owner Name',
      ownerEmail: 'owner@example.com',
      ownerAddressLine1: '10 Main St',
      ownerCity: 'Orlando',
      anticipatedAnnualPremium: '2400',
    })
  })

  it.each([
    'TargetPremium',
    'Target Premium',
    'CommissionableTargetPremium',
    'Commissionable Target Premium',
    'CTP',
    'TargetPremiumAmount',
  ])('normalises the explicit carrier alias %s', (alias) => {
    const snapshot = toInforcePolicySnapshot({ PolicyNumber: 'NL-CTP', [alias]: ' 1,200.00 ' })
    expect(snapshot?.targetPremium).toBe('1,200.00')
  })

  it('does not derive Target Premium from AAP, PremiumAmt, modal premium, or commission', () => {
    const snapshot = toInforcePolicySnapshot({
      PolicyNumber: 'NL-NO-CTP',
      AAP: '1200.00',
      PremiumAmt: '1200.00',
      ModalPremium: '100.00',
      Commission: '960.00',
    })

    expect(snapshot?.targetPremium).toBeNull()
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

describe('National Life inforce persistence isolation', () => {
  it('returns the written policies when the optional promotion writer fails', async () => {
    persistenceMocks.inforceUpsert.mockResolvedValue({})
    persistenceMocks.transaction.mockResolvedValue([])
    persistenceMocks.agentFindMany.mockRejectedValue(new Error('promotion ledger unavailable'))
    const snapshot = toInforcePolicySnapshot({ PolicyNumber: 'NL-SAFE-SYNC' })
    if (!snapshot) throw new Error('Expected mapped inforce policy')

    await expect(
      persistInforcePolicies({
        agentId: 'agent-1',
        deploymentScope: 'test',
        snapshots: [snapshot],
        fetchedAt: new Date('2026-08-10T00:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      written: 1,
      promotionCredits: {
        status: 'NEEDS_REVIEW',
        skipped: { PROMOTION_WRITER_FAILED: 1 },
      },
    })
  })
})
