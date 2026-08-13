import { describe, expect, it } from 'vitest'
import {
  CalendarDomainError,
  normalizeAttendees,
  ownedCalendarEventWhere,
  ownedCaseWhere,
  requireWritableCalendar,
  scheduleData,
} from './access'

describe('calendar access and validation', () => {
  it('builds redundant owner predicates for events and cases', () => {
    expect(ownedCalendarEventWhere('user-1', 'event-1')).toEqual({
      id: 'event-1', ownerUserId: 'user-1',
      integration: { userId: 'user-1' }, calendar: { integration: { userId: 'user-1' } },
    })
    expect(ownedCaseWhere('user-1', 'case-1')).toEqual({ id: 'case-1', assignedAgent: { userId: 'user-1' } })
  })

  it('requires both ownership and a writable connected calendar', () => {
    expect(() => requireWritableCalendar({ accessRole: 'writer', integration: { status: 'CONNECTED', userId: 'user-1' } }, 'user-1')).not.toThrow()
    expect(() => requireWritableCalendar({ accessRole: 'reader', integration: { status: 'CONNECTED', userId: 'user-1' } }, 'user-1')).toThrowError(expect.objectContaining({ code: 'CALENDAR_NOT_WRITABLE' }))
    expect(() => requireWritableCalendar({ accessRole: 'owner', integration: { status: 'CONNECTED', userId: 'user-2' } }, 'user-1')).toThrowError(expect.objectContaining({ code: 'CALENDAR_NOT_FOUND' }))
  })

  it('normalizes and de-duplicates attendees', () => {
    expect(normalizeAttendees([
      { email: ' PERSON@Example.com ', name: ' Person ' },
      { email: 'person@example.com', name: 'Updated' },
    ])).toEqual([{ email: 'person@example.com', name: 'Updated' }])
    expect(() => normalizeAttendees([{ email: 'not-an-email' }])).toThrow(CalendarDomainError)
  })

  it('uses exclusive end dates for all-day events', () => {
    expect(scheduleData({ allDay: true, startDate: '2026-08-12', endDate: '2026-08-13' })).toMatchObject({
      allDay: true, startsAt: null, endsAt: null,
    })
    expect(() => scheduleData({ allDay: true, startDate: '2026-08-12', endDate: '2026-08-12' })).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })
})
