import { describe, expect, it } from 'vitest'
import { carrierSyncLabel, carrierSyncState } from './carrier-sync-state'

describe('carrierSyncState', () => {
  it('is quiet when there is nothing in flight', () => {
    expect(carrierSyncState({ working: 0, blocked: 0 })).toEqual({ kind: 'IN_SYNC' })
  })

  it('counts what is on its way', () => {
    expect(carrierSyncState({ working: 2, blocked: 0 })).toEqual({ kind: 'WORKING', count: 2 })
  })

  it('counts what is waiting on the agent', () => {
    expect(carrierSyncState({ working: 0, blocked: 3 })).toEqual({ kind: 'NEEDS_YOU', count: 3 })
  })

  // Blocked wins: it is the only state that asks the agent for something, and
  // a badge that says "a caminho" while something waits on a login is the
  // silence this whole feature exists to remove.
  it('lets the state that asks for something win', () => {
    expect(carrierSyncState({ working: 5, blocked: 1 })).toEqual({ kind: 'NEEDS_YOU', count: 1 })
  })
})

describe('carrierSyncLabel', () => {
  it('uses the three agreed sentences', () => {
    expect(carrierSyncLabel({ kind: 'IN_SYNC' })).toBe('Em dia')
    expect(carrierSyncLabel({ kind: 'WORKING', count: 2 })).toBe('2 a caminho')
    expect(carrierSyncLabel({ kind: 'NEEDS_YOU', count: 3 })).toBe('Precisa de você')
  })

  // The count is in the working label and deliberately not in the blocked one:
  // "Precisa de você" is a call to act, and a number in it invites reading it
  // as progress rather than as a request.
  it('keeps the count out of the call to act', () => {
    expect(carrierSyncLabel({ kind: 'NEEDS_YOU', count: 9 })).not.toContain('9')
  })
})
