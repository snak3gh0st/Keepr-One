import { describe, expect, it } from 'vitest'
import {
  canonicalNationalLifeNavigatePath,
  matchesNationalLifeStagePath,
  shouldInstrumentNationalLifePath,
} from './constants'

describe('National Life content-script boundary', () => {
  it('never instruments login, MFA, or authentication callbacks', () => {
    for (const pathname of [
      '/agent/auth/login',
      '/agent/auth/mfa',
      '/agent/auth/mfacallback',
      '/agent/auth/logincallback',
      '/agent/signin',
    ]) {
      expect(shouldInstrumentNationalLifePath(pathname)).toBe(false)
    }
  })

  it('instruments authenticated agent pages', () => {
    expect(shouldInstrumentNationalLifePath('/agent/')).toBe(true)
    expect(shouldInstrumentNationalLifePath('/agent/book-of-business/inforce-book/all-clients'))
      .toBe(true)
  })

  it('accepts only the known in-force route redirect as a legacy alias', () => {
    expect(matchesNationalLifeStagePath(
      'INFORCE_CLIENTS',
      '/agent/book-of-business/inforce-book/all-clients',
      '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'INFORCE_CLIENTS',
      '/agent/other-page',
      '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
    )).toBe(false)
  })

  it('accepts the paid-commission menu redirect only for that stage', () => {
    expect(matchesNationalLifeStagePath(
      'PAID_COMMISSIONS',
      '/agent/compensation/commissions/paid-commissions',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'COMMISSIONS_EARNING_REPORT',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'PROJECTED_COMMISSIONS',
      '/agent/compensation/commissions/projected-commissions',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(false)
  })

  it('lands legacy projected and payable routes on the carrier personal report', () => {
    const personal =
      '/agent/compensation/commissions/projected-commissions/payable-gross-commissions/personal'
    expect(matchesNationalLifeStagePath(
      'PROJECTED_COMMISSIONS',
      '/agent/compensation/commissions/projected-commissions',
      personal,
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'PAYABLE_GROSS_COMMISSIONS',
      '/agent/compensation/commissions/projected-commissions/payable-gross-commissions',
      personal,
    )).toBe(true)
  })

  it('accepts the final personal route for pending lapse policies', () => {
    expect(matchesNationalLifeStagePath(
      'LIFE_PENDING_LAPSE',
      '/agent/book-of-business/inforce-book/life-pending-lapse-report',
      '/agent/book-of-business/inforce-book/life-pending-lapse-report/personal',
    )).toBe(true)
  })

  // Verified live against the portal on 2026-08-17: each of these menu routes
  // redirects to a child the catalogue did not name, so the tab never reached the
  // path the stage was waiting for and the run reported PORTAL_ROUTE_CHANGED for
  // all five. The server catalogue now names the final route, and these aliases
  // cover a run whose plan was persisted before that deploy.
  it.each([
    [
      'ANNUITY_PAST_DUE_CONTRIBUTIONS',
      '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution',
      '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution/personal',
    ],
    [
      'ANNUITY_PAYROLL_FLOW_CHANGES',
      '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes',
      '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes/personal',
    ],
    [
      'PREMIUM_REPORT_AGENCY',
      '/agent/book-of-business/inforce-book/premium-report-agency',
      '/agent/book-of-business/inforce-book/premium-report-agency/personal',
    ],
    [
      'LIFE_PERSISTENCY',
      '/agent/book-of-business/inforce-book/life-persistency-report',
      '/agent/book-of-business/inforce-book/life-persistency-report/personal',
    ],
    // The odd one out: this report lands on `/agent`, not `/personal`. Reading the
    // suffix as a convention rather than as five separate observations would have
    // left this stage failing.
    [
      'PLACEMENT_REPORT',
      '/agent/book-of-business/new-business/placement-report',
      '/agent/book-of-business/new-business/placement-report/agent',
    ],
  ])('lands the redirecting %s menu route on its final report page', (gridKey, menuPath, finalPath) => {
    expect(canonicalNationalLifeNavigatePath(gridKey, menuPath)).toBe(finalPath)
    expect(matchesNationalLifeStagePath(gridKey, menuPath, finalPath)).toBe(true)
    // Already-canonical plans stay canonical, and the tab that is already there
    // resumes without a navigation.
    expect(canonicalNationalLifeNavigatePath(gridKey, finalPath)).toBe(finalPath)
    expect(matchesNationalLifeStagePath(gridKey, finalPath, finalPath)).toBe(true)
  })

  it('does not let one redirecting report accept another report\'s page', () => {
    expect(matchesNationalLifeStagePath(
      'LIFE_PERSISTENCY',
      '/agent/book-of-business/inforce-book/life-persistency-report',
      '/agent/book-of-business/inforce-book/premium-report-agency/personal',
    )).toBe(false)
    expect(matchesNationalLifeStagePath(
      'PLACEMENT_REPORT',
      '/agent/book-of-business/new-business/placement-report',
      '/agent/book-of-business/new-business/placement-report/personal',
    )).toBe(false)
  })
})
