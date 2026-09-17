import { describe, expect, it } from 'vitest'
import { currentPortfolioFromSnapshot, verifyPortfolioPages, type StoredPortfolioRow } from './current-portfolio'
import type { InforceRow } from './portfolio-reconcile'
import { buildNationalLifePortfolioMetrics } from '../policy-metrics'

const observedAt = new Date('2026-09-03T15:39:25Z')
const row = (policyNumber: string, premium: string | null, policyStatus = 'Active'): InforceRow => ({
  deploymentScope: 'LOCAL_CONNECTOR', agentNumber: null, policyNumber, policyStatus,
  lastStatusChangeDate: null, policyIssueDate: null, productName: null, insuredClientName: null,
  insuredDob: null, insuredEmail: null, insuredPhoneNumber: null, insuredZipcode: null,
  ownerClientName: null, anticipatedAnnualPremium: premium,
})
const stored = (policyNumber: string): StoredPortfolioRow => ({
  policyNumber, agentId: 'a1', clientId: policyNumber, status: 'INFORCE', sourceStatus: 'Active',
  premium: null, sourceUpdatedAt: new Date('2026-08-27'),
})

describe('current completed National portfolio', () => {
  it('uses current membership/status/money, counts repeats once and preserves historical records separately', () => {
    const result = currentPortfolioFromSnapshot({
      rows: [row('p1', '1200.12'), row('p1', '1200.12'), row('p2', '0'), row('p3', '800.01', 'Pending Lapse')],
      stored: [stored('p1'), stored('p2'), stored('p3'), stored('old')], observedAt,
    })
    expect(result.historicalPolicies).toBe(1)
    expect(result.rows).toHaveLength(3)
    expect(result.statusCounts).toEqual([{ status: 'INFORCE', count: 3 }])
    expect(result.productCounts).toEqual([{ product: 'Unknown', count: 3 }])
    expect(buildNationalLifePortfolioMetrics(result.rows)).toMatchObject({
      activePolicies: 3, activeClients: 3, activeAap: 2000.13, premiumMissingPolicies: 0,
      premiumCoverageComplete: true, pendingLapsePolicies: 1, atRiskAap: 800.01,
      atRiskPremiumCoverageComplete: true, lastUpdatedAt: observedAt,
    })
  })
  it('does not invent client identities to fill an average before CRM reconciliation', () => {
    const result = currentPortfolioFromSnapshot({ rows: [row('new', '1200')], stored: [], observedAt })
    expect(buildNationalLifePortfolioMetrics(result.rows)).toMatchObject({
      activeAap: 1200, premiumCoverageComplete: true, clientCoverageComplete: false,
      clientMissingPolicies: 1, averageAapPerClient: null, activeClients: 0,
    })
  })
  it('rejects conflicting duplicates instead of choosing a convenient amount', () => {
    expect(() => currentPortfolioFromSnapshot({
      rows: [row('p1', '100'), row('p1', '200')], stored: [], observedAt,
    })).toThrow('NATIONAL_PORTFOLIO_SNAPSHOT_CONFLICT')
  })
  it('rejects a duplicate that disagrees about status, whatever the amounts say', () => {
    expect(() => currentPortfolioFromSnapshot({
      rows: [row('p1', '100'), row('p1', '100', 'Lapsed')], stored: [], observedAt,
    })).toThrow('NATIONAL_PORTFOLIO_SNAPSHOT_CONFLICT')
  })
  it.each([
    ['amount first', ['100', null]],
    ['blank first', [null, '100']],
  ])('treats a blank premium as unknown rather than a contradiction (%s)', (_label, premiums) => {
    // The carrier repeats a policy with the premium column empty. "100" and
    // "unknown" do not disagree, and reconcileInforceRows already keeps the
    // amount — rejecting the snapshot here took down the whole portfolio.
    const result = currentPortfolioFromSnapshot({
      rows: [row('p1', premiums[0]), row('p1', premiums[1])], stored: [], observedAt,
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].premium).toBe(100)
  })
  it('still rejects a real disagreement hiding among blank duplicates', () => {
    expect(() => currentPortfolioFromSnapshot({
      rows: [row('p1', '100'), row('p1', null), row('p1', '250')], stored: [], observedAt,
    })).toThrow('NATIONAL_PORTFOLIO_SNAPSHOT_CONFLICT')
  })
  it('keeps a policy whose premium is unknown in every duplicate', () => {
    const result = currentPortfolioFromSnapshot({
      rows: [row('p1', null), row('p1', null)], stored: [], observedAt,
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].premium).toBeNull()
  })
  it('does not count export footers as policies', () => {
    expect(currentPortfolioFromSnapshot({ rows: [row('Exported On: today', null)], stored: [], observedAt }).rows).toEqual([])
  })
})

describe('completed export evidence', () => {
  const complete = { expectedRecordCount: 2, receivedRecordCount: 2, finalSequence: 1, truncated: false,
    pages: [0, 1].map((sequence) => ({ sequence, recordCount: 1, records: [{}], observedAt })) }
  it('accepts only reconciled contiguous pages', () => expect(verifyPortfolioPages(complete)).toHaveLength(2))
  it.each([
    { truncated: true }, { expectedRecordCount: 3 }, { receivedRecordCount: 3 },
    { finalSequence: 2 }, { pages: complete.pages.slice(0, 1) },
    { pages: [complete.pages[0], complete.pages[0]] },
    { pages: [{ ...complete.pages[0], records: [] }, complete.pages[1]] },
  ])('rejects incomplete evidence %j', (patch) => {
    expect(() => verifyPortfolioPages({ ...complete, ...patch })).toThrow('NATIONAL_PORTFOLIO_SNAPSHOT_INCOMPLETE')
  })
})

it('exposes the same current set to the list and Today, including snapshot-only rows', () => {
  const current = currentPortfolioFromSnapshot({ rows: [row('local', '100'), row('source-only', '250', 'Pending Lapse')], stored: [stored('local'), stored('historical')], observedAt })
  expect(current.rows.map((policy) => policy.policyNumber)).toEqual(['local', 'source-only'])
  expect(current.rows.find((policy) => policy.policyNumber === 'source-only')).toMatchObject({ id: null, sourceStatus: 'Pending Lapse', sourceProvider: 'NATIONAL_LIFE' })
  expect(current.rows.filter((policy) => policy.status === 'INFORCE')).toHaveLength(buildNationalLifePortfolioMetrics(current.rows).activePolicies)
  expect(current.historicalPolicies).toBe(1)
})
