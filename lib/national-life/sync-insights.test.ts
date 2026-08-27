import { describe, expect, it } from 'vitest'
import { estimateSyncWindow, summarizeSyncDelta } from './sync-insights'

describe('estimateSyncWindow', () => {
  it('uses the observed duration of each remaining source instead of dividing a run evenly', () => {
    const result = estimateSyncWindow({
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS', 'COMMISSIONS_EARNING_REPORT'],
      completedGridKeys: ['NEW_BUSINESS'],
      history: [
        {
          startedAt: new Date('2026-08-25T10:00:00.000Z'),
          completions: [
            { gridKey: 'NEW_BUSINESS', completedAt: new Date('2026-08-25T10:02:00.000Z') },
            { gridKey: 'INFORCE_CLIENTS', completedAt: new Date('2026-08-25T10:12:00.000Z') },
            { gridKey: 'COMMISSIONS_EARNING_REPORT', completedAt: new Date('2026-08-25T10:15:00.000Z') },
          ],
        },
        {
          startedAt: new Date('2026-08-26T10:00:00.000Z'),
          completions: [
            { gridKey: 'NEW_BUSINESS', completedAt: new Date('2026-08-26T10:02:00.000Z') },
            { gridKey: 'INFORCE_CLIENTS', completedAt: new Date('2026-08-26T10:14:00.000Z') },
            { gridKey: 'COMMISSIONS_EARNING_REPORT', completedAt: new Date('2026-08-26T10:18:00.000Z') },
          ],
        },
      ],
    })

    expect(result).toEqual({ lowerMinutes: 13, upperMinutes: 16, basisRuns: 2 })
  })

  it('returns no estimate when there is no comparable completed run', () => {
    expect(estimateSyncWindow({
      plannedGridKeys: ['NEW_BUSINESS'],
      completedGridKeys: [],
      history: [],
    })).toBeNull()
  })
})

describe('summarizeSyncDelta', () => {
  it('keeps newly added rows, reconfirmed rows and new commission dollars distinct', () => {
    expect(summarizeSyncDelta({
      addedBySource: { NEW_BUSINESS: 3, COMMISSIONS_EARNING_REPORT: 2 },
      refreshedBySource: { NEW_BUSINESS: 7, INFORCE_CLIENTS: 120 },
      newCommissionAmounts: ['$100.25', '-$20.00', 'invalid'],
    })).toEqual({
      addedRecords: 5,
      refreshedRecords: 127,
      newCommissionAmount: 80.25,
    })
  })
})
