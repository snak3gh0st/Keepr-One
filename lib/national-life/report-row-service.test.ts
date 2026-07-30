import { describe, expect, it } from 'vitest'
import { deriveRowKey, toReportRow, toReportRows } from './report-row-service'

describe('National Life report row mapping', () => {
  it('maps a paid-commissions row, pulling amounts out of their markup', () => {
    const row = toReportRow('PAID_COMMISSIONS', {
      PayDate: '07/25/2026',
      FullName: 'Novaes, C',
      PayStatement: '<a href="/statement?id=5">View</a>',
      NLDCommEarningAmt: '<span>$1,234.56</span>',
      CommChargebackBalance: '<span>$0.00</span>',
      ESICommEarningAmt: null,
      GlobalId: '99887',
      Corp_Ind: 'N',
    })

    expect(row).toMatchObject({
      rowKey: '99887|07/25/2026',
      primaryDate: '07/25/2026',
      label: 'Novaes, C',
      amounts: { NLDCommEarningAmt: '$1,234.56', CommChargebackBalance: '$0.00' },
    })
    // A null amount must be absent, not the string "null".
    expect(row.amounts).not.toHaveProperty('ESICommEarningAmt')
  })

  it('maps a projected-commissions row across its lines of business', () => {
    const row = toReportRow('PROJECTED_COMMISSIONS', {
      AgentName: null,
      AgentNumber: '99887',
      NLLifeAmount: '100.00',
      NLAnnuitiesAmount: '0.00',
      LSWLifeAmount: '<span>250.00</span>',
      VariableProductAmount: '10.00',
      PaymentDate: '08/01/2026',
    })

    expect(row).toMatchObject({
      rowKey: '99887|08/01/2026',
      primaryDate: '08/01/2026',
      label: '99887',
      amounts: {
        NLLifeAmount: '100.00',
        NLAnnuitiesAmount: '0.00',
        LSWLifeAmount: '250.00',
        VariableProductAmount: '10.00',
      },
    })
  })

  it('keeps the carrier row verbatim', () => {
    const raw = { GlobalId: '1', PayDate: '07/25/2026', Unmapped: 'keep' }
    expect(toReportRow('PAID_COMMISSIONS', raw).raw).toBe(raw)
  })

  it('hashes a row from an unmapped report so it still upserts deterministically', () => {
    const row = { Whatever: 'x', Another: 2 }
    const first = deriveRowKey('COMMISSIONS_OVERVIEW', row)
    const second = deriveRowKey('COMMISSIONS_OVERVIEW', { ...row })

    expect(first).toEqual(second)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not collide two different unmapped rows', () => {
    expect(deriveRowKey('COMMISSIONS_OVERVIEW', { a: 1 })).not.toEqual(
      deriveRowKey('COMMISSIONS_OVERVIEW', { a: 2 }),
    )
  })

  it('falls back to a hash when the keying fields are missing', () => {
    expect(deriveRowKey('PAID_COMMISSIONS', { FullName: 'no id or date' })).toMatch(
      /^[0-9a-f]{32}$/,
    )
  })

  it('collapses rows that share a key', () => {
    const rows = toReportRows('PAID_COMMISSIONS', [
      { GlobalId: '1', PayDate: '07/25/2026', FullName: 'Stale' },
      { GlobalId: '1', PayDate: '07/25/2026', FullName: 'Fresh' },
      { GlobalId: '2', PayDate: '07/25/2026' },
    ])

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.rowKey === '1|07/25/2026')?.label).toBe('Fresh')
  })
})

describe('National Life per-policy commission earning detail', () => {
  const DETAIL_ROW = {
    PolicyNumber: 'NL123456',
    NBPolicyNumber: 'NB999',
    InsuredName: 'Doe, Jane',
    PayeeName: 'FNB INVESTMENTS CORP',
    Product: 'FlexLife II',
    GrossCommEarned: '1234.56',
    PremiumAmt: '500.00',
    CommRate: '0.55',
    ParticipationPercentage: '100',
    TransactionType: 'FYC',
    CompensationType: 'Commission',
    IncomeClass: 'Life',
    PaymentDate: '07/25/2026',
    ProcessDate: '07/24/2026',
    PremiumEffDate: '07/01/2026',
  }

  it('lifts the commissioning figures into amounts', () => {
    const row = toReportRow('COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as never, DETAIL_ROW)

    expect(row.amounts).toMatchObject({
      GrossCommEarned: '1234.56',
      PremiumAmt: '500.00',
      CommRate: '0.55',
      ParticipationPercentage: '100',
    })
  })

  it('labels the row by policy, not by the payee that repeats across rows', () => {
    const row = toReportRow('COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as never, DETAIL_ROW)
    expect(row.label).toBe('NL123456')
    expect(row.primaryDate).toBe('07/25/2026')
  })

  it('keeps two transactions on the same policy apart', () => {
    const rows = toReportRows('COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as never, [
      DETAIL_ROW,
      { ...DETAIL_ROW, TransactionType: 'REN', GrossCommEarned: '10.00' },
    ])

    expect(rows).toHaveLength(2)
  })

  it('still collapses a genuinely identical transaction row', () => {
    const rows = toReportRows('COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as never, [
      DETAIL_ROW,
      { ...DETAIL_ROW },
    ])

    expect(rows).toHaveLength(1)
  })
})

describe('National Life report row identity stability', () => {
  it('keys a paid-commission row the same way across runs', () => {
    const row = { GlobalId: '77', PayDate: '07/25/2026', FullName: 'X' }
    expect(deriveRowKey('PAID_COMMISSIONS', row)).toBe(
      deriveRowKey('PAID_COMMISSIONS', { ...row, FullName: 'Y' }),
    )
  })

  it('does not treat a detail row as a statement row', () => {
    // Guards the branch that distinguishes the two by their own fields.
    const detail = { PolicyNumber: 'NL1', GrossCommEarned: '1.00', TransactionType: 'FYC' }
    expect(deriveRowKey('COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as never, detail)).toContain(
      'NL1',
    )
  })
})

describe('rowKey for the grids mapped on 2026-07-30', () => {
  it('keys a service call on the carrier case id', () => {
    expect(deriveRowKey('CLIENT_INTELLIGENCE', { CaseDetailsId: 90210, CustomerName: 'X' })).toBe(
      '90210',
    )
  })

  it('keys a document on its handle', () => {
    expect(deriveRowKey('CORRESPONDENCE', { DocumentHandle: 5551, PolicyNumber: 'P1' })).toBe('5551')
  })

  it('keys a payee on the GlobalId a commission row references', () => {
    expect(deriveRowKey('COMMISSIONS_PAYMENT_PORTAL', { GlobalId: 'G-7', FullName: 'Y' })).toBe('G-7')
  })

  it('keys a pending increase on policy and agent together', () => {
    expect(deriveRowKey('PIP_PENDING', { PolicyNo: 'P9', AgentNumber: 'A2' })).toBe('P9|A2')
  })

  it('falls back to a content hash rather than colliding when the key is absent', () => {
    const a = deriveRowKey('CLIENT_INTELLIGENCE', { CustomerName: 'A' })
    const b = deriveRowKey('CLIENT_INTELLIGENCE', { CustomerName: 'B' })
    expect(a).not.toBe(b)
    expect(a).toHaveLength(32)
  })
})
