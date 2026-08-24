import { describe, expect, it } from 'vitest'
import { nyDayBounds, parseCrmLocalDateTime, quickFollowUpDate, zonedDateTimeToUtc } from './time'

describe('CRM New York date helpers', () => {
  it('converts wall-clock values on both sides of daylight saving time', () => {
    expect(zonedDateTimeToUtc({ year: 2026, month: 1, day: 15, hour: 9 }).toISOString()).toBe('2026-01-15T14:00:00.000Z')
    expect(zonedDateTimeToUtc({ year: 2026, month: 8, day: 15, hour: 9 }).toISOString()).toBe('2026-08-15T13:00:00.000Z')
  })

  it('keeps quick dates on the CRM calendar rather than UTC calendar', () => {
    const now = new Date('2026-08-12T03:30:00.000Z') // Aug 11, 23:30 in New York
    expect(quickFollowUpDate(0, now).toISOString()).toBe('2026-08-11T13:00:00.000Z')
    expect(quickFollowUpDate(1, now).toISOString()).toBe('2026-08-12T13:00:00.000Z')
  })

  it('parses a date-only reminder at 09:00 New York', () => {
    expect(parseCrmLocalDateTime('2026-08-16').toISOString()).toBe('2026-08-16T13:00:00.000Z')
    expect(parseCrmLocalDateTime('2026-08-16T14:30').toISOString()).toBe('2026-08-16T18:30:00.000Z')
  })

  it('rejects normalized and nonexistent wall-clock dates', () => {
    expect(() => parseCrmLocalDateTime('2026-02-31T09:00')).toThrow('Invalid CRM local date/time')
    expect(() => parseCrmLocalDateTime('2026-13-01T09:00')).toThrow('Invalid CRM local date/time')
    expect(() => parseCrmLocalDateTime('2026-03-08T02:30')).toThrow('Invalid CRM local date/time')
  })

  it('returns DST-aware local day bounds', () => {
    const { start, end } = nyDayBounds(new Date('2026-03-08T16:00:00.000Z'))
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })
})
