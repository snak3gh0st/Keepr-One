import { describe, expect, it } from 'vitest'
import { filterStatuses, periodStart, summarizeStatuses } from './overview'

describe('AI reporting semantics', () => {
  it('keeps unknown and provider-accepted sends out of confirmed impact', () => {
    const result = summarizeStatuses(['PENDING', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'SENT', 'DELIVERED', 'READ', 'CANCELLED'].map(status => ({ status, _count: { _all: 1 } })))
    expect(result).toEqual({ total: 8, working: 2, attention: 2, sent: 3, delivered: 2, read: 1 })
    expect(filterStatuses('completed')).not.toContain('UNKNOWN')
    expect(filterStatuses('attention')).toContain('FAILED')
  })
  it('uses inclusive UTC calendar days across month and year boundaries', () => {
    const now = new Date('2026-01-03T01:30:00Z')
    expect(periodStart('month', now).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(periodStart('7d', now).toISOString()).toBe('2025-12-28T00:00:00.000Z')
    expect(periodStart('30d', now).toISOString()).toBe('2025-12-05T00:00:00.000Z')
  })
})
