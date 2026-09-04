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
