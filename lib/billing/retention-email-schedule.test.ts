import { describe, expect, it } from 'vitest'
import {
  decideRetentionEmail,
  LAPSED_REMINDER_INTERVAL_DAYS,
  LAPSED_REMINDER_MAX_SENDS,
  type RetentionEmailState,
} from './retention-email-schedule'

const NOW = new Date('2026-09-17T12:00:00.000Z')
const DAY_MS = 86_400_000

function state(overrides: Partial<RetentionEmailState> = {}): RetentionEmailState {
  return {
    sentKeys: [],
    lastSentAt: null,
    lapsedSends: 0,
    optedOut: false,
    subscribed: false,
    accessEndsAt: new Date(NOW.getTime() + 5 * DAY_MS),
    ...overrides,
  }
}

describe('decideRetentionEmail', () => {
  it('stops the moment the account subscribes', () => {
    expect(decideRetentionEmail(state({ subscribed: true }), NOW)).toEqual({
      send: false,
      reason: 'ALREADY_SUBSCRIBED',
    })
  })

  it('respects an opt-out even while messages are due', () => {
    expect(decideRetentionEmail(state({ optedOut: true }), NOW)).toEqual({
      send: false,
      reason: 'OPTED_OUT',
    })
  })

  it('stays quiet while the trial still has plenty of time left', () => {
    const far = state({ accessEndsAt: new Date(NOW.getTime() + 20 * DAY_MS) })
    expect(decideRetentionEmail(far, NOW)).toEqual({ send: false, reason: 'NOTHING_DUE' })
  })

  it('sends the seven-day notice once the window opens', () => {
    const due = state({ accessEndsAt: new Date(NOW.getTime() + 6 * DAY_MS) })
    expect(decideRetentionEmail(due, NOW)).toEqual({
      send: true,
      step: 'TRIAL_ENDING_7D',
      sequenceNumber: 1,
    })
  })

  it('never repeats a step it already delivered', () => {
    const due = state({
      accessEndsAt: new Date(NOW.getTime() + 6 * DAY_MS),
      sentKeys: ['TRIAL_ENDING_7D'],
    })
    expect(decideRetentionEmail(due, NOW)).toEqual({ send: false, reason: 'ALREADY_SENT' })
  })

  it('skips a stale step when a pass was missed, sending only the urgent one', () => {
    // One day left: both the 7-day and 3-day steps are technically "due", but
    // telling somebody their trial ends in a week would be false.
    const due = state({ accessEndsAt: new Date(NOW.getTime() + 1 * DAY_MS) })
    expect(decideRetentionEmail(due, NOW)).toEqual({
      send: true,
      step: 'TRIAL_ENDING_1D',
      sequenceNumber: 1,
    })
  })

  it('moves to the lapsed reminder once access has ended', () => {
    const lapsed = state({
      accessEndsAt: new Date(NOW.getTime() - 1 * DAY_MS),
      sentKeys: ['TRIAL_ENDING_7D', 'TRIAL_ENDING_3D', 'TRIAL_ENDING_1D'],
    })
    expect(decideRetentionEmail(lapsed, NOW)).toEqual({
      send: true,
      step: 'ACCESS_LAPSED',
      sequenceNumber: 1,
    })
  })

  it('spaces the lapsed reminders instead of sending them daily', () => {
    const lapsed = state({
      accessEndsAt: new Date(NOW.getTime() - 10 * DAY_MS),
      lapsedSends: 1,
      lastSentAt: new Date(NOW.getTime() - 2 * DAY_MS),
    })
    expect(decideRetentionEmail(lapsed, NOW)).toEqual({ send: false, reason: 'NOTHING_DUE' })
  })

  it('sends the next lapsed reminder once the interval has passed', () => {
    const lapsed = state({
      accessEndsAt: new Date(NOW.getTime() - 20 * DAY_MS),
      lapsedSends: 1,
      lastSentAt: new Date(NOW.getTime() - (LAPSED_REMINDER_INTERVAL_DAYS + 1) * DAY_MS),
    })
    expect(decideRetentionEmail(lapsed, NOW)).toEqual({
      send: true,
      step: 'ACCESS_LAPSED',
      sequenceNumber: 2,
    })
  })

  it('eventually stops writing to an address that never converts', () => {
    const exhausted = state({
      accessEndsAt: new Date(NOW.getTime() - 200 * DAY_MS),
      lapsedSends: LAPSED_REMINDER_MAX_SENDS,
      lastSentAt: new Date(NOW.getTime() - 60 * DAY_MS),
    })
    expect(decideRetentionEmail(exhausted, NOW)).toEqual({
      send: false,
      reason: 'SEQUENCE_EXHAUSTED',
    })
  })

  it('does nothing without a known end of access', () => {
    expect(decideRetentionEmail(state({ accessEndsAt: null }), NOW)).toEqual({
      send: false,
      reason: 'NOTHING_DUE',
    })
  })
})
