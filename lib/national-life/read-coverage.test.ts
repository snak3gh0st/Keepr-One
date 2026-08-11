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

  it('has one definition per source and never equates the current grids with full coverage', () => {
    const keys = NATIONAL_LIFE_READ_COVERAGE.map((source) => source.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(nationalLifeReadCoverageSummary()).toEqual({
      required: 30,
      automatic: 13,
      remaining: 17,
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
