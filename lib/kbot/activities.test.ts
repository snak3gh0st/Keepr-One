import { describe, expect, it } from 'vitest'
import { carrierActivities, followupActivityGroup } from './activities'
describe('activity grouping from persisted state', () => {
  it('keeps independent operations and prioritizes partial results for review', () => {
    const rows = carrierActivities({
      sync: { runId: 'r', state: 'PARTIAL', completed: 8, total: 14, shouldPoll: false },
      illustration: { id: 'i', state: 'WORKING', updatedAt: '2026-09-04T12:00:00Z' },
      application: { id: 'a', caseId: 'c', state: 'READY', updatedAt: '2026-09-04T12:00:00Z' },
    })
    expect(rows.map(r => r.group)).toEqual(['attention', 'working', 'history'])
    expect(rows[2].href).toBe('/agent/cases/c')
    expect(rows[0].progress).toEqual({ completed: 8, total: 14 })
  })
  it('does not claim that an unknown stopped sync completed', () => {
    expect(carrierActivities({ sync: { completed: 0, total: 14, shouldPoll: false } })[0]).toMatchObject({ status: 'UNKNOWN', group: 'attention' })
    expect(carrierActivities({ sync: { state: 'PAUSED', completed: 2, total: 14, shouldPoll: true } })[0].group).toBe('attention')
  })
  it('keeps unconfirmed sends out of completed history', () => {
    expect(followupActivityGroup('UNKNOWN')).toBe('attention')
    expect(followupActivityGroup('ACCEPTED')).toBe('working')
    expect(followupActivityGroup('DELIVERED')).toBe('history')
  })
})
