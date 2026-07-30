import { describe, expect, it } from 'vitest'
import { extractCommissionDetailLinks } from './commission-detail'

const NLD_CELL =
  "<a href='/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=e3ec1234a5678ac9a1a00000d123bb45'>NLD</a>"
const CHARGEBACK_CELL =
  '<a href="/agent/compensation/commissions/paid-commissions/commissions-earning-report/chargeback?id=99ba777ea1234567">$0.00</a>'

describe('National Life commission detail links', () => {
  it('pulls the statement drill-down out of the rendered cell', () => {
    const links = extractCommissionDetailLinks({ NLDCommEarningAmt: NLD_CELL })

    expect(links).toEqual([
      {
        kind: 'NLD_COMMISSION_EARNING',
        path:
          '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=e3ec1234a5678ac9a1a00000d123bb45',
        statementId: 'e3ec1234a5678ac9a1a00000d123bb45',
      },
    ])
  })

  it('finds both the earning report and the chargeback report', () => {
    const links = extractCommissionDetailLinks({
      NLDCommEarningAmt: NLD_CELL,
      CommChargebackBalance: CHARGEBACK_CELL,
    })

    expect(links.map((link) => link.kind).sort()).toEqual([
      'CHARGEBACK',
      'NLD_COMMISSION_EARNING',
    ])
  })

  it('collapses the same link repeated across cells', () => {
    const links = extractCommissionDetailLinks({
      NLDCommEarningAmt: NLD_CELL,
      ESICommEarningAmt: NLD_CELL,
    })

    expect(links).toHaveLength(1)
  })

  it('ignores the javascript-only statement anchor, which carries no id', () => {
    const links = extractCommissionDetailLinks({
      PayStatement:
        '<a href="javascript:void(0);" class="getHierarchyReportDetails" rel="a1234d567b89b1a234c5678901d2e3">Pay</a>',
    })

    expect(links).toEqual([])
  })

  it('returns nothing for a row with no markup at all', () => {
    expect(extractCommissionDetailLinks({ PayDate: '07/25/2026', GlobalId: '1' })).toEqual([])
  })

  it('tolerates null and non-string cells', () => {
    expect(
      extractCommissionDetailLinks({ ESICommEarningAmt: null, NLDCommEarningAmt: 42 }),
    ).toEqual([])
  })
})
