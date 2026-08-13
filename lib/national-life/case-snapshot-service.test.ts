import { describe, expect, it, vi } from 'vitest'

const persistenceMocks = vi.hoisted(() => ({
  caseUpsert: vi.fn(),
  transaction: vi.fn(),
  agentFindMany: vi.fn(),
}))

vi.mock('../prisma', () => ({
  prisma: {
    nationalLifeCaseSnapshot: { upsert: persistenceMocks.caseUpsert },
    $transaction: persistenceMocks.transaction,
    agent: { findMany: persistenceMocks.agentFindMany },
  },
}))

import {
  persistCaseSnapshots,
  toCaseSnapshot,
  toCaseSnapshots,
} from './case-snapshot-service'

describe('National Life case snapshot mapping', () => {
  it('maps the carrier field names onto the snapshot shape', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL123456',
      InsuredOrAnnuitantName: 'Doe, Jane',
      OwnerName: 'Doe, Jane',
      Product: 'FlexLife II',
      DerivedStatusDescription: 'Pending Requirements',
      DeliveryStatus: 'Not Sent',
      ActionRequired: 'Agent',
      Requirements: '2 outstanding',
      SubmitDate: '07/01/2026',
      SentDate: null,
      ModalPremium: '125.00',
      AnticipatedAnnualPremium: '1500.00',
      CommissionableTargetPremium: '1200.00',
      SubmitMethod: 'eApp',
      CaseManager: 'Smith, Bob',
      Agency: 'Some Agency',
      WritingAgentName: 'Novaes, C',
      WritingAgentNumber: '99887',
      CompanyCode: 'NLIC',
    })

    expect(snapshot).toMatchObject({
      policyNo: 'NL123456',
      insuredName: 'Doe, Jane',
      carrierStatus: 'Pending Requirements',
      deliveryStatus: 'Not Sent',
      anticipatedAnnualPremium: '1500.00',
      targetPremium: '1200.00',
      companyCode: 'NLIC',
      sentDate: null,
    })
  })

  it('keeps the untouched carrier row so nothing is lost to normalisation', () => {
    const row = { PolicyNo: 'NL1', Unmapped: 'keep me', IsFollowUp: true }
    expect(toCaseSnapshot(row)?.raw).toBe(row)
  })

  it('reads through rendered markup that the grid returns in cells', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL2',
      Requirements: '<a href="/x?id=9"><span class="badge">3</span> outstanding</a>',
      InsuredOrAnnuitantName: 'Doe,&nbsp;John',
    })

    expect(snapshot?.requirements).toBe('3 outstanding')
    expect(snapshot?.insuredName).toBe('Doe, John')
  })

  it('drops a row with no policy number because there is no upsert key', () => {
    expect(toCaseSnapshot({ InsuredOrAnnuitantName: 'Nobody' })).toBeNull()
    expect(toCaseSnapshot({ PolicyNo: '   ' })).toBeNull()
  })

  it('coerces non-string scalars the carrier occasionally returns', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL3',
      ModalPremium: 125,
      TargetPremium: 1200,
      CompanyCode: 0,
    })
    expect(snapshot).toMatchObject({
      modalPremium: '125',
      targetPremium: '1200',
      companyCode: '0',
    })
  })

  it.each([
    'TargetPremium',
    'CommissionableTargetPremium',
    'CTP',
    'TargetPremiumAmount',
  ])('normalises the explicit carrier alias %s', (alias) => {
    const snapshot = toCaseSnapshot({ PolicyNo: 'NL-CTP', [alias]: ' 1,200.00 ' })
    expect(snapshot?.targetPremium).toBe('1,200.00')
  })

  it('does not derive Target Premium from modal premium, generic premium, or commission', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL-NO-CTP',
      ModalPremium: '100.00',
      PremiumAmt: '1200.00',
      Commission: '960.00',
    })

    expect(snapshot?.targetPremium).toBeNull()
  })

  it('collapses a policy repeated across pages onto one snapshot', () => {
    const snapshots = toCaseSnapshots([
      { PolicyNo: 'NL9', DerivedStatusDescription: 'Stale' },
      { PolicyNo: 'NL9', DerivedStatusDescription: 'Fresh' },
      { PolicyNo: 'NL8' },
      { InsuredOrAnnuitantName: 'skipped' },
    ])

    expect(snapshots).toHaveLength(2)
    expect(snapshots.find((s) => s.policyNo === 'NL9')?.carrierStatus).toBe('Fresh')
  })
})

describe('National Life grid field-name drift', () => {
  it('reads the recently-closed grid, which names status and agent differently', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: '<a href="/x">NL777</a>',
      InsuredOrAnnuitantName: 'Roe, Ann',
      PolicyStatus: 'Incomplete - Closed',
      AgentName: 'Novaes, C',
      AgentNumber: '99887',
      AnticipatedAnnualPremiumDollarValue: '2400.00',
    })

    expect(snapshot).toMatchObject({
      policyNo: 'NL777',
      carrierStatus: 'Incomplete - Closed',
      writingAgentName: 'Novaes, C',
      writingAgentNumber: '99887',
      anticipatedAnnualPremium: '2400.00',
    })
  })

  it('prefers the primary field name when both are present', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL1',
      DerivedStatusDescription: 'Issued',
      PolicyStatus: 'ignored',
    })
    expect(snapshot?.carrierStatus).toBe('Issued')
  })

  it('falls through a blank primary field to the alternate', () => {
    const snapshot = toCaseSnapshot({
      PolicyNo: 'NL1',
      DerivedStatusDescription: '   ',
      PolicyStatus: 'Issued',
    })
    expect(snapshot?.carrierStatus).toBe('Issued')
  })
})

describe('National Life case persistence isolation', () => {
  it('returns the written snapshots when the optional promotion writer fails', async () => {
    persistenceMocks.caseUpsert.mockResolvedValue({})
    persistenceMocks.transaction.mockResolvedValue([])
    persistenceMocks.agentFindMany.mockRejectedValue(new Error('promotion ledger unavailable'))
    const snapshot = toCaseSnapshot({ PolicyNo: 'NL-SAFE-SYNC' })
    if (!snapshot) throw new Error('Expected mapped case snapshot')

    await expect(
      persistCaseSnapshots({
        agentId: 'agent-1',
        deploymentScope: 'test',
        gridKey: 'NEW_BUSINESS',
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
