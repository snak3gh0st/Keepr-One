import { describe, expect, it } from 'vitest'
import { GoogleFreeBusyPermissionMissingError } from './google/freebusy'
import { checkCalendarConflictPolicy } from './conflicts'

const schedule = {
  allDay: false as const,
  startsAt: new Date('2026-08-12T14:00:00.000Z'),
  endsAt: new Date('2026-08-12T14:30:00.000Z'),
  timeZone: 'America/New_York',
}

const event = {
  id: 'busy-1', ownerUserId: 'owner-1', integrationId: 'integration-1',
  calendar: { id: 'calendar-1', providerCalendarId: 'primary', name: 'Principal', backgroundColor: null, foregroundColor: null },
  caseId: null, providerEventId: 'provider-busy', title: 'Reunião existente', description: null,
  allDay: false, startsAt: '2026-08-12T14:00:00.000Z', endsAt: '2026-08-12T14:30:00.000Z',
  startDate: null, endDate: null, timeZone: 'America/New_York', location: null, meetingUrl: null,
  conferenceData: null, reminders: null, recurrence: [], status: 'CONFIRMED' as const,
  source: 'GOOGLE' as const, syncStatus: 'SYNCED' as const, syncErrorCode: null, localRevision: 1,
  attendees: [], createdAt: '2026-08-12T13:00:00.000Z', updatedAt: '2026-08-12T13:00:00.000Z',
}

const dependencies = {
  secret: () => 'test-secret-at-least-thirty-two-characters',
  now: () => Date.parse('2026-08-12T13:00:00.000Z'),
  googleConfigured: () => false,
}

describe('shared calendar conflict policy', () => {
  it('requires an explicit signed override and binds it to owner, event and exact range', async () => {
    const getEvents = async () => [event]
    const first = await checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', schedule, userTimeZone: schedule.timeZone },
      { ...dependencies, getEvents: getEvents as never },
    )
    expect(first).toMatchObject({ ok: false, code: 'SCHEDULE_CONFLICT', conflicts: [{ id: 'busy-1' }] })
    if (first.ok) throw new Error('expected conflict')

    await expect(checkCalendarConflictPolicy(
      {
        ownerUserId: 'owner-1', schedule, userTimeZone: schedule.timeZone,
        allowConflict: true, conflictOverrideToken: first.conflictOverrideToken,
      },
      { ...dependencies, getEvents: getEvents as never },
    )).resolves.toEqual({ ok: true, conflicts: [] })

    const shifted = { ...schedule, endsAt: new Date('2026-08-12T14:45:00.000Z') }
    await expect(checkCalendarConflictPolicy(
      {
        ownerUserId: 'owner-1', schedule: shifted, userTimeZone: shifted.timeZone,
        allowConflict: true, conflictOverrideToken: first.conflictOverrideToken,
      },
      { ...dependencies, getEvents: getEvents as never },
    )).resolves.toMatchObject({ ok: false, code: 'SCHEDULE_CONFLICT' })
  })

  it('rejects an override token issued to another owner or event', async () => {
    const getEvents = async () => [event]
    const db = { calendarEvent: { findFirst: async () => ({ ...schedule, allDay: false, startDate: null, endDate: null }) } } as never
    const issued = await checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', eventId: 'event-1', schedule, userTimeZone: schedule.timeZone },
      { ...dependencies, db, getEvents: getEvents as never },
    )
    if (issued.ok) throw new Error('expected conflict')
    await expect(checkCalendarConflictPolicy(
      {
        ownerUserId: 'owner-1', eventId: 'event-2', schedule, userTimeZone: schedule.timeZone,
        allowConflict: true, conflictOverrideToken: issued.conflictOverrideToken,
      },
      { ...dependencies, db, getEvents: getEvents as never },
    )).resolves.toMatchObject({ ok: false, code: 'SCHEDULE_CONFLICT' })
  })

  it('degrades only missing optional FreeBusy consent to local conflict checks', async () => {
    await expect(checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', schedule, userTimeZone: schedule.timeZone },
      {
        ...dependencies,
        googleConfigured: () => true,
        googleEnv: () => ({}) as never,
        getEvents: (async () => []) as never,
        getFreeBusy: (async () => { throw new GoogleFreeBusyPermissionMissingError() }) as never,
      },
    )).resolves.toEqual({ ok: true, conflicts: [] })

    await expect(checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', schedule, userTimeZone: schedule.timeZone },
      {
        ...dependencies,
        googleConfigured: () => true,
        googleEnv: () => ({}) as never,
        getEvents: (async () => []) as never,
        getFreeBusy: (async () => { throw new Error('provider unavailable') }) as never,
      },
    )).rejects.toThrow('provider unavailable')
  })

  it('loads an omitted PATCH schedule through an owner-scoped event query', async () => {
    const findFirst = async (args: { where: unknown }) => {
      expect(args.where).toMatchObject({
        id: 'event-1', ownerUserId: 'owner-1',
        integration: { userId: 'owner-1' }, calendar: { integration: { userId: 'owner-1' } },
      })
      return { ...schedule, allDay: false, startDate: null, endDate: null }
    }
    await expect(checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', eventId: 'event-1', userTimeZone: schedule.timeZone },
      { ...dependencies, db: { calendarEvent: { findFirst } } as never, getEvents: (async () => []) as never },
    )).resolves.toEqual({ ok: true, conflicts: [] })
  })

  it('authenticates PATCH event ownership even when a replacement schedule is supplied', async () => {
    const findFirst = async (args: { where: unknown }) => {
      expect(args.where).toMatchObject({ id: 'event-1', ownerUserId: 'owner-1' })
      return null
    }
    await expect(checkCalendarConflictPolicy(
      { ownerUserId: 'owner-1', eventId: 'event-1', schedule, userTimeZone: schedule.timeZone },
      { ...dependencies, db: { calendarEvent: { findFirst } } as never, getEvents: (async () => []) as never },
    )).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' })
  })
})
