import { describe, expect, it } from 'vitest'
import { NATIONAL_LIFE_ACQUISITION_CATALOG } from './acquisition-catalog'
import { NATIONAL_LIFE_READ_COVERAGE } from './read-coverage'

describe('National Life acquisition catalogue', () => {
  it('makes exactly one acquisition decision for every known source', () => {
    expect(NATIONAL_LIFE_ACQUISITION_CATALOG.map((source) => source.key)).toEqual(
      NATIONAL_LIFE_READ_COVERAGE.map((source) => source.key),
    )
    expect(new Set(NATIONAL_LIFE_ACQUISITION_CATALOG.map((source) => source.key)).size).toBe(30)
  })

  it('does not activate an official export until its portal request is proven', () => {
    const exports = NATIONAL_LIFE_ACQUISITION_CATALOG.filter(
      (source) => source.preferredStrategy === 'OFFICIAL_EXPORT',
    )
    expect(exports.length).toBeGreaterThan(0)
    expect(exports.every((source) => source.activation === 'PROBE_REQUIRED')).toBe(true)
    expect(exports.find((source) => source.key === 'PAYABLE_GROSS_COMMISSIONS')).toMatchObject({
      fallbackStrategy: 'JSON_GRID',
      dedupeGroup: 'PROJECTED_PAYABLE_COMMISSIONS',
    })
  })

  it('declares overlapping commission sources instead of double counting them', () => {
    const grouped = NATIONAL_LIFE_ACQUISITION_CATALOG.filter((source) => source.dedupeGroup)
    expect(grouped.map((source) => source.key)).toEqual(expect.arrayContaining([
      'PAYABLE_GROSS_COMMISSIONS',
      'PAID_COMMISSIONS',
      'COMMISSIONS_EARNING_REPORT',
    ]))
  })
})
