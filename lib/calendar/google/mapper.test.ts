import { describe, expect, it } from 'vitest'
import { mapGoogleEvent, mapLocalEventToGoogle } from './mapper'

describe('Google event mapper', () => {
  it('preserves exclusive all-day dates, recurrence and cancelled exceptions', () => {
    const mapped = mapGoogleEvent({
      id: 'exception', status: 'cancelled', summary: 'Weekly meeting',
      start: { date: '2026-08-12' }, end: { date: '2026-08-13' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE'], recurringEventId: 'master',
      originalStartTime: { date: '2026-08-12' },
    })
    expect(mapped.allDay).toBe(true)
    expect(mapped.startDate?.toISOString().slice(0, 10)).toBe('2026-08-12')
    expect(mapped.endDate?.toISOString().slice(0, 10)).toBe('2026-08-13')
    expect(mapped.providerRecurringEventId).toBe('master')
    expect(mapped.status).toBe('CANCELLED')
  })

  it('projects a bounded weekly instance with its master/original identity', () => {
    const mapped = mapGoogleEvent({
      id: 'weekly-master_20260817T130000Z', summary: 'Weekly team meeting',
      status: 'confirmed', recurringEventId: 'weekly-master',
      originalStartTime: { dateTime: '2026-08-17T09:00:00-04:00', timeZone: 'America/New_York' },
      start: { dateTime: '2026-08-17T09:00:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-08-17T10:00:00-04:00', timeZone: 'America/New_York' },
    })
    expect(mapped.providerRecurringEventId).toBe('weekly-master')
    expect(mapped.providerOriginalStartAt?.toISOString()).toBe('2026-08-17T13:00:00.000Z')
    expect(mapped.startsAt?.toISOString()).toBe('2026-08-17T13:00:00.000Z')
  })

  it('writes IANA timezone, reminders, attendees and Meet request', () => {
    const payload = mapLocalEventToGoogle({
      id: 'local-1', localRevision: 3, title: 'Lead meeting', description: null,
      allDay: false, startsAt: new Date('2026-08-12T18:00:00Z'), endsAt: new Date('2026-08-12T19:00:00Z'),
      startDate: null, endDate: null, timeZone: 'America/New_York', location: null,
      colorId: null, visibility: null, transparency: null, recurrence: [],
      conferenceData: { createMeetRequested: true },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      attendees: [{ email: 'lead@example.com', name: 'Lead' }],
    })
    expect(payload.start).toMatchObject({ dateTime: '2026-08-12T18:00:00.000Z', timeZone: 'America/New_York' })
    expect(payload.attendees).toEqual([{ email: 'lead@example.com', displayName: 'Lead' }])
    expect(payload.reminders?.overrides).toEqual([{ method: 'popup', minutes: 15 }])
    expect(payload.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe('hangoutsMeet')
  })
})
