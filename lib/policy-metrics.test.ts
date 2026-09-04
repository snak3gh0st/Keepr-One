import { describe, expect, it } from 'vitest'
import * as policyMetrics from './policy-metrics'

const {
  annualizedPolicyPremium,
  auditedAnnualizedPolicyPremium,
  auditedNationalLifeAap,
} = policyMetrics

describe('annualizedPolicyPremium', () => {
  it.each([
    [250, 'MONTHLY', 3_000],
    [750, 'Quarterly', 3_000],
    [1_500, 'Semi-Annual', 3_000],
    [3_000, 'ANNUAL', 3_000],
    [3_000, null, 3_000],
  ])('normalizes a recorded policy premium without mixing payment modes', (premium, mode, expected) => {
    expect(annualizedPolicyPremium(premium, mode)).toBe(expected)
  })

  it('excludes missing and non-positive values instead of presenting them as production', () => {
    expect(annualizedPolicyPremium(null, 'MONTHLY')).toBe(0)
    expect(annualizedPolicyPremium(0, 'MONTHLY')).toBe(0)
  })

  it('blocks an unknown payment mode from an audited total', () => {
    expect(auditedAnnualizedPolicyPremium(250, 'Every other week')).toBeNull()
    expect(annualizedPolicyPremium(250, 'Every other week')).toBe(0)
  })
})

describe('auditedNationalLifeAap', () => {
  it('keeps the carrier AAP annual instead of multiplying a stale modal frequency', () => {
    expect(auditedNationalLifeAap(1_200)).toBe(1_200)
  })

  it.each([null, undefined, '', ' ', 'invalid', NaN, Infinity, -1, false, {}])('fails closed for missing or invalid AAP: %s', (value) => {
    expect(auditedNationalLifeAap(value)).toBeNull()
  })

  it.each([0, '0', '0.00', { toString: () => '0' }])('preserves an explicit carrier zero: %s', (value) => {
    expect(auditedNationalLifeAap(value)).toBe(0)
  })
})

describe('buildNationalLifePortfolioMetrics', () => {
  it('turns National policy rows into active-book and retention metrics', () => {
    const build = (policyMetrics as typeof policyMetrics & {
      buildNationalLifePortfolioMetrics?: (rows: unknown[]) => unknown
    }).buildNationalLifePortfolioMetrics
    const metrics = build?.([
      {
        clientId: 'client-1',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: 1_200,
        sourceUpdatedAt: new Date('2026-09-03T14:00:00.000Z'),
      },
      {
        clientId: 'client-1',
        status: 'INFORCE',
        sourceStatus: 'Pending Lapse',
        premium: 800,
        sourceUpdatedAt: new Date('2026-09-03T15:00:00.000Z'),
      },
      {
        clientId: 'client-2',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: 1_000,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-3',
        status: 'LAPSED',
        sourceStatus: 'Lapsed',
        premium: 500,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-4',
        status: 'CANCELLED',
        sourceStatus: 'Not Active',
        premium: null,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
    ])

    expect(metrics).toEqual({
      hasData: true,
      activeClients: 2,
      clientCoverageComplete: true,
      clientMissingPolicies: 0,
      activePolicies: 3,
      activeAap: 3_000,
      averageAapPerClient: 1_500,
      premiumKnownPolicies: 3,
      premiumMissingPolicies: 0,
      premiumCoverageComplete: true,
      pendingLapsePolicies: 1,
      lapsedPolicies: 1,
      cancelledPolicies: 1,
      attentionPolicies: 3,
      atRiskAap: 800,
      atRiskPremiumKnownPolicies: 1,
      atRiskPremiumMissingPolicies: 0,
      atRiskPremiumCoverageComplete: true,
      lostAap: 500,
      lastUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
    })
  })

  it('blocks the client average when any active policy has no confirmed AAP', () => {
    const metrics = policyMetrics.buildNationalLifePortfolioMetrics([
      {
        clientId: 'client-1',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: 1_200,
        sourceUpdatedAt: null,
      },
      {
        clientId: 'client-2',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: null,
        sourceUpdatedAt: null,
      },
    ])

    expect(metrics.activeAap).toBe(1_200)
    expect(metrics.premiumKnownPolicies).toBe(1)
    expect(metrics.premiumMissingPolicies).toBe(1)
    expect(metrics.premiumCoverageComplete).toBe(false)
    expect(metrics.averageAapPerClient).toBeNull()
  })

  it('marks AAP at risk as incomplete when a Pending Lapse policy has no premium', () => {
    const metrics = policyMetrics.buildNationalLifePortfolioMetrics([
      {
        clientId: 'client-1',
        status: 'INFORCE',
        sourceStatus: 'Pending Lapse',
        premium: 800,
        sourceUpdatedAt: null,
      },
      {
        clientId: 'client-2',
        status: 'INFORCE',
        sourceStatus: 'Pending Lapse',
        premium: null,
        sourceUpdatedAt: null,
      },
    ])

    expect(metrics.atRiskAap).toBe(800)
    expect(metrics.atRiskPremiumKnownPolicies).toBe(1)
    expect(metrics.atRiskPremiumMissingPolicies).toBe(1)
    expect(metrics.atRiskPremiumCoverageComplete).toBe(false)
  })
})
