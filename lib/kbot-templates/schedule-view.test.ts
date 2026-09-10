import { describe, expect, it } from 'vitest'
import { blockedReasonTotals, bucketForJob, toScheduledEntry, type ScheduledJobRow } from './schedule-view'

const row = (over: Partial<ScheduledJobRow>): ScheduledJobRow => ({
  id: 'job-1',
  category: 'BIRTHDAY',
  customerName: 'Ana Ribeiro',
  phone: '+14075550100',
  language: 'PT',
  status: 'PENDING',
  errorCode: null,
  content: null,
  createdAt: new Date('2026-09-01T12:00:00.000Z'),
  updatedAt: new Date('2026-09-01T12:00:00.000Z'),
  ...over,
})

describe('scheduled buckets', () => {
  it('separates what is waiting, what left, what was held back and what broke', () => {
    expect(bucketForJob({ status: 'PENDING' })).toBe('SCHEDULED')
    expect(bucketForJob({ status: 'DISPATCHING' })).toBe('SCHEDULED')
    expect(bucketForJob({ status: 'ACCEPTED' })).toBe('SENT')
    expect(bucketForJob({ status: 'DELIVERED' })).toBe('SENT')
    expect(bucketForJob({ status: 'BLOCKED' })).toBe('BLOCKED')
    expect(bucketForJob({ status: 'FAILED' })).toBe('ATTENTION')
    expect(bucketForJob({ status: 'UNKNOWN' })).toBe('ATTENTION')
  })

  it('carries the gate reason through for a blocked row', () => {
    expect(toScheduledEntry(row({ status: 'BLOCKED', errorCode: 'QUIET_HOURS' }))).toMatchObject({
      bucket: 'BLOCKED',
      blockedReason: 'QUIET_HOURS',
    })
  })

  it('shows no reason rather than an internal code it cannot explain', () => {
    expect(toScheduledEntry(row({ status: 'BLOCKED', errorCode: 'SOMETHING_ELSE' })).blockedReason).toBeNull()
    expect(toScheduledEntry(row({ status: 'SENT', errorCode: 'OPTED_OUT' })).blockedReason).toBeNull()
  })
})

describe('why nobody was contacted', () => {
  it('counts contacts by reason, most frequent first', () => {
    const entries = [
      row({ id: 'a', status: 'BLOCKED', errorCode: 'OPTED_OUT' }),
      row({ id: 'b', status: 'BLOCKED', errorCode: 'OPTED_OUT' }),
      row({ id: 'c', status: 'BLOCKED', errorCode: 'QUIET_HOURS' }),
      row({ id: 'd', status: 'SENT' }),
    ].map(toScheduledEntry)
    expect(blockedReasonTotals(entries)).toEqual([
      { reason: 'OPTED_OUT', total: 2 },
      { reason: 'QUIET_HOURS', total: 1 },
    ])
  })
})
