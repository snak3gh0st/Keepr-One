import { describe, expect, it } from 'vitest'
import {
  dateRangeForInstants,
  dayBoundsInTimeZone,
  isValidIanaTimeZone,
  parseCalendarDate,
  zonedDateTimeToUtc,
} from './time'

describe('calendar time helpers', () => {
  it('validates IANA time zones without silently falling back', () => {
    expect(isValidIanaTimeZone('America/New_York')).toBe(true)
    expect(isValidIanaTimeZone('Asia/Tokyo')).toBe(true)
    expect(isValidIanaTimeZone('Not/A_Zone')).toBe(false)
    expect(isValidIanaTimeZone(' America/New_York')).toBe(false)
  })

  it('returns DST-aware day bounds', () => {
    const spring = dayBoundsInTimeZone(new Date('2026-03-08T16:00:00.000Z'), 'America/New_York')
    expect(spring.start.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(spring.end.toISOString()).toBe('2026-03-09T04:00:00.000Z')
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 60 * 60 * 1000)

    const fall = dayBoundsInTimeZone(new Date('2026-11-01T16:00:00.000Z'), 'America/New_York')
    expect(fall.end.getTime() - fall.start.getTime()).toBe(25 * 60 * 60 * 1000)
  })

  it('rejects nonexistent wall-clock times during spring-forward', () => {
    expect(() => zonedDateTimeToUtc({
      year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0,
    }, 'America/New_York')).toThrow('Invalid local calendar date/time')
  })

  it('maps an instant range to local date-only boundaries for eastern time zones', () => {
    const range = dateRangeForInstants(
      new Date('2026-08-11T15:00:00.000Z'),
      new Date('2026-08-12T15:00:00.000Z'),
      'Pacific/Auckland',
    )
    expect(range.startDate.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(range.endDate.toISOString().slice(0, 10)).toBe('2026-08-14')
  })

  it('parses strict date-only values', () => {
    expect(parseCalendarDate('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(() => parseCalendarDate('2026-02-30')).toThrow('Invalid calendar date')
  })
})
