import { describe, expect, it } from 'vitest'
import {
  extractCommissionDetailLinks,
  extractNationalLifeCommissionEarningLinks,
  normalizeNationalLifeCommissionEarningPath,
} from './commission-detail'

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

describe('National Life chargeback debt drill-down', () => {
  it('follows the DetailsLink on a chargeback row', () => {
    const links = extractCommissionDetailLinks({
      DetailsLink:
        "<a href='/agent/compensation/commissions/paid-commissions/commissions-earning-report/chargeback/debt?id=77caadc1234bda567b890c12dcc34'>Details<a>",
    })

    expect(links).toEqual([
      {
        kind: 'CHARGEBACK_DEBT',
        path:
          '/agent/compensation/commissions/paid-commissions/commissions-earning-report/chargeback/debt?id=77caadc1234bda567b890c12dcc34',
        statementId: '77caadc1234bda567b890c12dcc34',
      },
    ])
  })

  it('does not confuse the debt link with the chargeback summary link', () => {
    const links = extractCommissionDetailLinks({
      CommChargebackBalance: '<a href="/x/commissions-earning-report/chargeback?id=aaa1">$0.00</a>',
      DetailsLink: "<a href='/x/commissions-earning-report/chargeback/debt?id=bbb2'>Details<a>",
    })

    expect(links.map((link) => link.kind).sort()).toEqual(['CHARGEBACK', 'CHARGEBACK_DEBT'])
  })
})

describe('National Life earning-link handoff', () => {
  it('deduplicates statement links across the stored parent rows', () => {
    expect(
      extractNationalLifeCommissionEarningLinks([
        { NLDCommEarningAmt: NLD_CELL },
        { ESICommEarningAmt: NLD_CELL },
      ]),
    ).toEqual([
      {
        path:
          '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=e3ec1234a5678ac9a1a00000d123bb45',
        statementId: 'e3ec1234a5678ac9a1a00000d123bb45',
      },
    ])
  })

  it('rejects an absolute link on another origin', () => {
    expect(
      normalizeNationalLifeCommissionEarningPath(
        'https://evil.example/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=abc',
      ),
    ).toBeNull()
  })

  it('rejects extra query parameters instead of handing them to the extension', () => {
    expect(
      normalizeNationalLifeCommissionEarningPath(
        '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=abc&x=1',
      ),
    ).toBeNull()
  })
})
