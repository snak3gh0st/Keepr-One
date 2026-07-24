import { describe, it, expect } from 'vitest'
import { buildCycleTimes, type CaseHistory } from './cycle-time'

const d = (iso: string) => new Date(iso)

describe('buildCycleTimes', () => {
  it('measures time in the from-stage from entry to the next transition', () => {
    const cases: CaseHistory[] = [
      {
        createdAt: d('2026-01-01T00:00:00Z'),
        transitions: [
          { from: 'LEAD', to: 'DISCOVERY', at: d('2026-01-03T00:00:00Z') }, // 2 days in LEAD
          { from: 'DISCOVERY', to: 'DESIGN', at: d('2026-01-08T00:00:00Z') }, // 5 days in DISCOVERY
        ],
      },
    ]
    const result = buildCycleTimes(cases)
    expect(result.find((r) => r.stage === 'LEAD')?.avgDays).toBe(2)
    expect(result.find((r) => r.stage === 'DISCOVERY')?.avgDays).toBe(5)
  })

  it('averages the same stage across cases and counts samples', () => {
    const cases: CaseHistory[] = [
      { createdAt: d('2026-01-01T00:00:00Z'), transitions: [{ from: 'LEAD', to: 'DISCOVERY', at: d('2026-01-05T00:00:00Z') }] }, // 4d
      { createdAt: d('2026-02-01T00:00:00Z'), transitions: [{ from: 'LEAD', to: 'DISCOVERY', at: d('2026-02-03T00:00:00Z') }] }, // 2d
    ]
    const lead = buildCycleTimes(cases).find((r) => r.stage === 'LEAD')
    expect(lead?.avgDays).toBe(3)
    expect(lead?.samples).toBe(2)
  })

  it('omits stages with no completed transitions and ignores negative durations', () => {
    const cases: CaseHistory[] = [
      { createdAt: d('2026-01-10T00:00:00Z'), transitions: [{ from: 'LEAD', to: 'DISCOVERY', at: d('2026-01-01T00:00:00Z') }] }, // negative → skipped
    ]
    expect(buildCycleTimes(cases)).toEqual([])
  })
})
