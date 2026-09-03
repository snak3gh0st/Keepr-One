import { describe, expect, it } from 'vitest'
import { buildPremiumEvolution, type PremiumEvolutionRow } from './premium-evolution'

const row = (policyNumber: string, premium: unknown, issueDate = '2026-08-01T00:00:00Z', product = 'FlexLife'): PremiumEvolutionRow => ({ policyNumber, premium, issueDate, product })
const build = (rows: PremiumEvolutionRow[], options = {}) => buildPremiumEvolution({ rows, verified: true, observedAt: new Date('2026-09-03T15:00:00Z'), ...options })

describe('National premium evolution', () => {
  it('groups current AAP by issue month, counts every status and sums cents exactly', () => {
    const result = build([row('a', 0.1), row('b', 0.2), row('c', 10, '2026-09-01T00:00:00Z')])
    expect(result.months.at(-2)).toMatchObject({ month: '2026-08', policies: 2, value: 0.3 })
    expect(result.total).toBe(10.3)
    expect(result.months[0].month).toBe('2025-10')
  })
  it('deduplicates overlapping agent exports and numeric representations', () => {
    expect(build([row('a', 10), row('a', '10.00')]).total).toBe(10)
  })
  it.each([
    row('a', 20), row('a', 10, '2026-07-01T00:00:00Z'), row('a', 10, undefined, 'Other'),
  ])('withholds conflicting policy versions', (duplicate) => {
    expect(build([row('a', 10), duplicate])).toMatchObject({ available: false, total: null })
  })
  it('keeps real zero but propagates unknown monthly money through cumulative', () => {
    const result = build([row('zero', 0, '2026-07-01T00:00:00Z'), row('missing', null), row('known', 10, '2026-09-01T00:00:00Z')])
    expect(result.months.at(-3)?.value).toBe(0)
    expect(result.months.at(-2)).toMatchObject({ value: null, cumulative: null, known: 0 })
    expect(result.months.at(-1)).toMatchObject({ value: 10, cumulative: null })
  })
  it('withholds totals for missing issue dates instead of dropping policies silently', () => {
    for (const issueDate of [null, 'invalid']) {
      const result = build([{ ...row('a', 10), issueDate }])
      expect(result.undated).toBe(1)
      expect(result.months.every((month) => month.value === null)).toBe(true)
    }
  })
  it('separately reports future-dated policies, including future days in the current month', () => {
    const result = build([row('future', 100, '2026-09-10T00:00:00Z'), row('current', 10)])
    expect(result).toMatchObject({ total: 10, policies: 1, futureDated: 1, undated: 0 })
  })
  it('filters exact product and UTC window, and accumulates only selected months', () => {
    const result = build([row('old', 100, '2026-03-31T23:59:59Z'), row('start', 10, '2026-04-01T00:00:00Z'), row('other', 200, undefined, 'Term')], { range: '6', product: 'FlexLife', view: 'cumulative' })
    expect(result).toMatchObject({ range: 6, view: 'cumulative', total: 10, policies: 1 })
  })
  it('requires verified source and normalizes unsupported filters', () => {
    expect(build([], { verified: false, range: '100', product: 'fake', view: 'fake' })).toMatchObject({ available: false, total: null, range: 12, product: '', view: 'monthly' })
    expect(build([], { observedAt: null }).available).toBe(false)
  })
})
