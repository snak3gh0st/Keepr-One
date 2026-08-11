import { describe, expect, it } from 'vitest'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  syncProgressFromJobs,
  syncRunStateFromJobs,
} from './sync-progress'

describe('National Life sync progress', () => {
  it('has the thirteen read-only portal stages in the execution order', () => {
    expect(NATIONAL_LIFE_SYNC_STAGES).toHaveLength(13)
    expect(NATIONAL_LIFE_SYNC_STAGES[0]).toBe('NEW_BUSINESS')
    expect(NATIONAL_LIFE_SYNC_STAGES.at(-1)).toBe('PAYABLE_GROSS_COMMISSIONS')
  })

  it('counts completed stages instead of rows', () => {
    expect(
      syncProgressFromJobs([
        { state: 'SUCCEEDED', syncStageIndex: 0, syncGridKey: 'NEW_BUSINESS' },
        { state: 'SUCCEEDED', syncStageIndex: 1, syncGridKey: 'RECENTLY_CLOSED' },
        { state: 'RUNNING', syncStageIndex: 2, syncGridKey: 'INFORCE_CLIENTS' },
      ]),
    ).toEqual({
      completed: 2,
      total: 13,
      percent: 15,
      currentGridKey: 'INFORCE_CLIENTS',
      failed: 0,
    })
  })

  it('pauses when a stage requires a new login', () => {
    expect(
      syncRunStateFromJobs([
        { state: 'SUCCEEDED', syncStageIndex: 0 },
        { state: 'ACTION_REQUIRED', syncStageIndex: 1 },
        { state: 'QUEUED', syncStageIndex: 2 },
      ]),
    ).toBe('PAUSED')
  })

  it('finishes partially when all stages are terminal and one failed', () => {
    expect(
      syncRunStateFromJobs([
        { state: 'SUCCEEDED', syncStageIndex: 0 },
        { state: 'FAILED', syncStageIndex: 1 },
        { state: 'SUCCEEDED', syncStageIndex: 2 },
      ]),
    ).toBe('PARTIAL')
  })
})
