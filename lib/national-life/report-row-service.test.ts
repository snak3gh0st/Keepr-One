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
