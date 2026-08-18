import { describe, expect, it } from 'vitest'
import { NATIONAL_LIFE_GRIDS } from './portal-grid-client'
import {
  NATIONAL_LIFE_AUTOMATIC_GRID_KEYS,
  NATIONAL_LIFE_READ_COVERAGE,
  nationalLifeReadCoverageSummary,
} from './read-coverage'

describe('National Life read coverage', () => {
  it('keeps every automatic grid in the portal catalogue', () => {
    for (const key of NATIONAL_LIFE_AUTOMATIC_GRID_KEYS) {
      expect(NATIONAL_LIFE_GRIDS[key]).toMatch(/^\/agent\//)
    }
  })

  // The catalogue must name the page the carrier actually serves, not the menu route
  // that redirects to it: the connector waits for the URL it asked for, so a menu
  // route fails the stage with PORTAL_ROUTE_CHANGED instead of reading the report.
  // These five did exactly that in the 2026-08-17 run; each final route below was
  // verified live against the portal the same day.
  it('names the report page the carrier redirects to, not the menu route', () => {
    expect(NATIONAL_LIFE_GRIDS.ANNUITY_PAST_DUE_CONTRIBUTIONS).toBe(
      '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution/personal',
    )
    expect(NATIONAL_LIFE_GRIDS.ANNUITY_PAYROLL_FLOW_CHANGES).toBe(
      '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes/personal',
    )
    expect(NATIONAL_LIFE_GRIDS.PREMIUM_REPORT_AGENCY).toBe(
      '/agent/book-of-business/inforce-book/premium-report-agency/personal',
    )
    expect(NATIONAL_LIFE_GRIDS.LIFE_PERSISTENCY).toBe(
      '/agent/book-of-business/inforce-book/life-persistency-report/personal',
    )
    // Not `/personal`: this one lands on `/agent`. The suffix is an observation per
    // report, not a convention.
    expect(NATIONAL_LIFE_GRIDS.PLACEMENT_REPORT).toBe(
      '/agent/book-of-business/new-business/placement-report/agent',
    )
  })

  it('has one definition per source and never equates the current grids with full coverage', () => {
    const keys = NATIONAL_LIFE_READ_COVERAGE.map((source) => source.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(nationalLifeReadCoverageSummary()).toEqual({
      required: 30,
      automatic: 15,
      remaining: 15,
    })
  })

  it('includes the detail, filtered-report, and document collectors required for full sync', () => {
    const collectors = new Set(NATIONAL_LIFE_READ_COVERAGE.map((source) => source.collector))
    expect(collectors).toEqual(new Set([
      'GRID',
      'DASHBOARD',
      'FILTERED_REPORT',
      'ENTITY_DETAIL',
      'DOCUMENT',
    ]))
  })
})
