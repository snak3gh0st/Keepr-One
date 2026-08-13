import { describe, expect, it, vi } from 'vitest'
import {
  associateCalendarEventWithCase,
  cancelCalendarEvent,
  createCalendarEvent,
  getCalendarEventForUser,
  getCalendarEventsForCase,
  getCalendarEventsForRange,
  getUpcomingCalendarEvents,
  setCalendarPreferences,
  updateCalendarEvent,
} from './repository'

const now = new Date('2026-08-12T14:00:00.000Z')

function eventRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    ownerUserId: 'user-1',
    integrationId: 'integration-1',
    insuranceCaseId: 'case-1',
    providerEventId: null,
    providerRecurringEventId: null,
    title: 'Reunião com Ana',
    description: null,
    allDay: false,
    startsAt: now,
    endsAt: new Date('2026-08-12T14:30:00.000Z'),
    startDate: null,
    endDate: null,
    timeZone: 'America/New_York',
    location: null,
    meetingUrl: null,
    conferenceData: null,
    reminders: null,
    recurrence: [],
    status: 'CONFIRMED',
    source: 'CRM',
    syncStatus: 'PENDING',
    syncErrorCode: null,
    localRevision: 1,
    createdAt: now,
    updatedAt: now,
    calendar: {
      id: 'calendar-1', providerCalendarId: 'primary', name: 'Principal',
      backgroundColor: '#0b8043', foregroundColor: '#ffffff',
    },
    attendees: [],
    ...overrides,
  }
}

function writableCalendar(overrides: Record<string, unknown> = {}) {
  return {
    id: 'calendar-1', integrationId: 'integration-1', accessRole: 'owner',
    integration: { userId: 'user-1', status: 'CONNECTED' },
    ...overrides,
  }
}

describe('calendar repository ownership', () => {
  it('scopes range reads redundantly to the owner and visible calendars', async () => {
    const findMany = vi.fn(async () => [])
    const db = {
      user: { findUnique: vi.fn(async () => ({ timeZone: 'America/New_York' })) },
      insuranceCase: { findFirst: vi.fn() },
      calendarEvent: { findMany },
    }
    const start = new Date('2026-08-12T04:00:00.000Z')
    const end = new Date('2026-08-13T04:00:00.000Z')
    await expect(getCalendarEventsForRange({ ownerUserId: 'user-1', start, end }, db as never)).resolves.toEqual([])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'user-1',
        integration: { userId: 'user-1' },
        calendar: { integration: { userId: 'user-1' }, visible: true },
      }),
    }))
  })

  it('rejects a downline case even if the caller can see it elsewhere in CRM', async () => {
    const findMany = vi.fn()
    const caseFind = vi.fn(async () => null)
    const db = { insuranceCase: { findFirst: caseFind }, calendarEvent: { findMany } }
    await expect(getCalendarEventsForCase({ ownerUserId: 'leader-user', caseId: 'downline-case' }, db as never))
      .rejects.toMatchObject({ code: 'CASE_NOT_OWNED' })
    expect(caseFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'downline-case', assignedAgent: { userId: 'leader-user' } },
    }))
    expect(findMany).not.toHaveBeenCalled()
  })

  it('resolves an owned deep-linked event independently of the visible range', async () => {
    const findFirst = vi.fn(async () => eventRecord({ id: 'outside-current-range' }))
    const db = { calendarEvent: { findFirst } }

    await expect(getCalendarEventForUser({
      ownerUserId: 'user-1',
      eventId: 'outside-current-range',
    }, db as never)).resolves.toMatchObject({ id: 'outside-current-range' })

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'outside-current-range',
        ownerUserId: 'user-1',
        integration: { userId: 'user-1' },
        calendar: { integration: { userId: 'user-1' } },
        deletedAt: null,
      },
    }))
  })

  it('returns no deep-linked event when the owner-scoped lookup finds nothing', async () => {
    const db = { calendarEvent: { findFirst: vi.fn(async () => null) } }
    await expect(getCalendarEventForUser({ ownerUserId: 'user-1', eventId: 'foreign-event' }, db as never))
      .resolves.toBeNull()
  })

  it('reads only the owner future window after today with index-friendly timed and all-day branches', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        eventRecord({
          id: 'timed-tomorrow',
          insuranceCaseId: null,
          startsAt: new Date('2026-08-13T14:00:00.000Z'),
          endsAt: new Date('2026-08-13T14:30:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([
        eventRecord({
          id: 'all-day-later',
          insuranceCaseId: null,
          allDay: true,
          startsAt: null,
          endsAt: null,
          startDate: new Date('2026-08-14T00:00:00.000Z'),
          endDate: new Date('2026-08-15T00:00:00.000Z'),
        }),
      ])
    const db = { calendarEvent: { findMany } }

    const result = await getUpcomingCalendarEvents({
      ownerUserId: 'user-1',
      now: new Date('2026-08-12T14:00:00.000Z'),
      timeZone: 'America/New_York',
      lookaheadDays: 7,
      limit: 4,
    }, db as never)

    expect(result.map((event) => event.id)).toEqual(['timed-tomorrow', 'all-day-later'])
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      take: 4,
      where: expect.objectContaining({
        ownerUserId: 'user-1',
        integration: { userId: 'user-1' },
        calendar: { integration: { userId: 'user-1' }, visible: true },
        allDay: false,
        // Today's local interval ends at 04:00Z. It is the inclusive lower
        // bound, so no event returned by the Hoje query can be repeated here.
        startsAt: {
          gte: new Date('2026-08-13T04:00:00.000Z'),
          lt: new Date('2026-08-20T04:00:00.000Z'),
        },
      }),
    }))
    expect(findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 4,
      where: expect.objectContaining({
        ownerUserId: 'user-1',
        allDay: true,
        startDate: {
          gte: new Date('2026-08-13T00:00:00.000Z'),
          lt: new Date('2026-08-20T00:00:00.000Z'),
        },
      }),
    }))
  })
})

describe('calendar repository mutations', () => {
  it('creates event, attendees, timeline and idempotent outbound job atomically', async () => {
    const outboxCreate = vi.fn(async () => ({ id: 'job-1' }))
    const timelineCreate = vi.fn(async () => ({ id: 'timeline-1' }))
    const calendarEventCreate = vi.fn(async () => eventRecord())
    const tx = {
      calendarSource: { findFirst: vi.fn(async () => writableCalendar()) },
      insuranceCase: { findFirst: vi.fn(async () => ({ id: 'case-1', assignedAgentId: 'agent-1' })) },
      calendarEvent: { create: calendarEventCreate },
      calendarSyncJob: { create: outboxCreate },
      caseTimelineEvent: { create: timelineCreate },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(createCalendarEvent({
      ownerUserId: 'user-1', caseId: 'case-1', title: ' Reunião com Ana ',
      schedule: {
        allDay: false, startsAt: now, endsAt: new Date('2026-08-12T14:30:00.000Z'),
        timeZone: 'America/New_York',
      },
      attendees: [{ email: 'ANA@EXAMPLE.COM' }],
      sendInvites: true,
    }, db as never)).resolves.toMatchObject({ id: 'event-1', title: 'Reunião com Ana' })

    expect(calendarEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerUserId: 'user-1', insuranceCaseId: 'case-1', title: 'Reunião com Ana',
        attendees: { create: [{ email: 'ana@example.com', name: null }] },
      }),
    }))
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        direction: 'OUTBOUND', operation: 'CREATE_EVENT', desiredRevision: 1, sendInvites: true,
        idempotencyKey: 'calendar:event:event-1:revision:1:create:invites:1',
      }),
    }))
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ caseId: 'case-1', type: 'CALENDAR_EVENT_CREATED', title: 'Compromisso criado' }),
    }))
  })

  it('uses compare-and-swap revision and preserves case association when omitted', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const outboxCreate = vi.fn(async () => ({ id: 'job-2' }))
    const tx = {
      calendarEvent: {
        findFirst: vi.fn(async () => ({
          id: 'event-1', calendarId: 'calendar-1', providerEventId: 'google-event',
          localRevision: 1, status: 'CONFIRMED', insuranceCaseId: 'case-1',
          allDay: false, startsAt: new Date('2026-08-12T14:00:00.000Z'),
          endsAt: new Date('2026-08-12T14:30:00.000Z'), startDate: null, endDate: null,
          timeZone: 'America/New_York',
        })),
        updateMany,
        findFirstOrThrow: vi.fn(async () => eventRecord({
          providerEventId: 'google-event', localRevision: 2,
          startsAt: new Date('2026-08-13T19:00:00.000Z'),
          endsAt: new Date('2026-08-13T19:30:00.000Z'),
        })),
      },
      calendarSource: { findFirst: vi.fn(async () => writableCalendar()) },
      insuranceCase: { findFirst: vi.fn() },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      calendarSyncJob: { create: outboxCreate },
      caseTimelineEvent: { create: vi.fn(async () => ({ id: 'timeline-2' })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await updateCalendarEvent({
      ownerUserId: 'user-1', eventId: 'event-1', baseRevision: 1,
      title: 'Novo título', sendInvites: false, recurrenceScope: 'SERIES',
      schedule: {
        allDay: false,
        startsAt: new Date('2026-08-13T19:00:00.000Z'),
        endsAt: new Date('2026-08-13T19:30:00.000Z'),
        timeZone: 'America/New_York',
      },
    }, db as never)

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'user-1', localRevision: 1 }),
      data: expect.objectContaining({ insuranceCaseId: undefined, localRevision: 2 }),
    }))
    expect(outboxCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        operation: 'UPDATE_EVENT', desiredRevision: 2,
        payload: { recurrenceScope: 'SERIES', previousCalendarId: 'calendar-1' },
      }),
    }))
    expect(tx.caseTimelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'CALENDAR_EVENT_UPDATED',
        body: 'Reunião com Ana · De 12/08/2026, 10:00 para 13/08/2026, 15:00.',
        metadata: expect.objectContaining({
          previousStartsAt: '2026-08-12T14:00:00.000Z',
          startsAt: '2026-08-13T19:00:00.000Z',
        }),
      }),
    }))
  })

  it('rejects stale edits before mutating data', async () => {
    const updateMany = vi.fn()
    const tx = {
      calendarEvent: { findFirst: vi.fn(async () => ({ id: 'event-1', localRevision: 2, status: 'CONFIRMED' })), updateMany },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    await expect(updateCalendarEvent({
      ownerUserId: 'user-1', eventId: 'event-1', baseRevision: 1, title: 'Stale', sendInvites: false,
    }, db as never)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('cancels idempotently and closes unread event notifications', async () => {
    const readAtUpdate = vi.fn(async () => ({ count: 2 }))
    const tx = {
      calendarEvent: {
        findFirst: vi.fn(async () => ({ id: 'event-1', localRevision: 1, status: 'CONFIRMED' })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirstOrThrow: vi.fn(async () => eventRecord({ localRevision: 2, status: 'CANCELLED' })),
      },
      calendarSyncJob: { create: vi.fn(async () => ({ id: 'job-3' })) },
      notification: { updateMany: readAtUpdate },
      caseTimelineEvent: { create: vi.fn(async () => ({ id: 'timeline-3' })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    await cancelCalendarEvent({
      ownerUserId: 'user-1', eventId: 'event-1', baseRevision: 1,
      sendInvites: true, recurrenceScope: 'THIS_EVENT',
    }, db as never)
    expect(readAtUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { calendarEventId: 'event-1', recipientUserId: 'user-1', readAt: null },
    }))
  })

  it('associates only an individually owned case and does not enqueue a provider write', async () => {
    const outboxCreate = vi.fn()
    const timelineCreate = vi.fn(async () => ({ id: 'timeline-4' }))
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      insuranceCase: { findFirst: vi.fn(async () => ({ id: 'case-1', assignedAgentId: 'agent-1' })) },
      calendarEvent: {
        findFirst: vi.fn(async () => ({ id: 'event-1', insuranceCaseId: null, localRevision: 1 })),
        updateMany,
        findFirstOrThrow: vi.fn(async () => eventRecord({ localRevision: 1 })),
      },
      caseTimelineEvent: { create: timelineCreate },
      calendarSyncJob: { create: outboxCreate },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    await associateCalendarEventWithCase({ ownerUserId: 'user-1', eventId: 'event-1', caseId: 'case-1' }, db as never)
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'CALENDAR_EVENT_ASSOCIATED' }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { insuranceCaseId: 'case-1' },
    }))
    const associationWrite = updateMany.mock.calls.at(0)?.at(0) as { data?: unknown } | undefined
    expect(associationWrite?.data).not.toHaveProperty('localRevision')
    expect(outboxCreate).not.toHaveBeenCalled()
  })

  it('sets visibility, one writable default, and the validated user time zone transactionally', async () => {
    const userUpdate = vi.fn(async () => ({ id: 'user-1' }))
    const connection = {
      id: 'integration-1', provider: 'GOOGLE', providerEmail: 'agent@example.com', displayName: null,
      status: 'CONNECTED', grantedScopes: [], tokenExpiresAt: null, connectedAt: now,
      lastSyncAt: null, lastErrorCode: null, calendars: [],
    }
    const tx = {
      calendarIntegration: {
        findUnique: vi.fn(async () => ({ id: 'integration-1', status: 'CONNECTED' })),
        findUniqueOrThrow: vi.fn(async () => connection),
      },
      calendarSource: {
        findMany: vi.fn(async () => [{
          ...writableCalendar(), visible: true, syncToken: 'sync-token', updatedAt: now,
        }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ id: 'calendar-1' })),
      },
      calendarSyncJob: { upsert: vi.fn(async () => ({ id: 'job-1' })) },
      user: { update: userUpdate },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    await setCalendarPreferences({
      ownerUserId: 'user-1', visibleCalendarIds: ['calendar-1'],
      crmDefaultCalendarId: 'calendar-1', timeZone: 'America/Chicago',
    }, db as never)
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { timeZone: 'America/Chicago' } })
  })

  it('queues one immediate idempotent sync when a hidden owned source becomes visible', async () => {
    const jobUpsert = vi.fn(async () => ({ id: 'job-activation' }))
    const hiddenAt = new Date('2026-08-12T15:01:02.003Z')
    const connection = {
      id: 'integration-1', provider: 'GOOGLE', providerEmail: 'agent@example.com', displayName: null,
      status: 'CONNECTED', grantedScopes: [], tokenExpiresAt: null, connectedAt: now,
      lastSyncAt: null, lastErrorCode: null, calendars: [],
    }
    const tx = {
      calendarIntegration: {
        findUnique: vi.fn(async () => ({ id: 'integration-1', status: 'CONNECTED' })),
        findUniqueOrThrow: vi.fn(async () => connection),
      },
      calendarSource: {
        findMany: vi.fn(async () => [{
          ...writableCalendar(), visible: false, syncToken: 'existing-sync-token', updatedAt: hiddenAt,
        }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ id: 'calendar-1' })),
      },
      calendarSyncJob: { upsert: jobUpsert },
      user: { update: vi.fn() },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await setCalendarPreferences({
      ownerUserId: 'user-1', visibleCalendarIds: ['calendar-1'],
      crmDefaultCalendarId: 'calendar-1',
    }, db as never)

    expect(jobUpsert).toHaveBeenCalledOnce()
    expect(jobUpsert).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'calendar:visibility:calendar-1:enabled-after:2026-08-12T15:01:02.003Z',
      },
      create: expect.objectContaining({
        integrationId: 'integration-1', calendarId: 'calendar-1', direction: 'INBOUND',
        operation: 'INCREMENTAL_SYNC',
        idempotencyKey: 'calendar:visibility:calendar-1:enabled-after:2026-08-12T15:01:02.003Z',
      }),
      update: {},
    })
  })

  it('uses a full sync for a newly enabled source without a sync token', async () => {
    const jobUpsert = vi.fn(async () => ({ id: 'job-activation' }))
    const tx = {
      calendarIntegration: {
        findUnique: vi.fn(async () => ({ id: 'integration-1', status: 'CONNECTED' })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'integration-1', provider: 'GOOGLE', providerEmail: 'agent@example.com', displayName: null,
          status: 'CONNECTED', grantedScopes: [], tokenExpiresAt: null, connectedAt: now,
          lastSyncAt: null, lastErrorCode: null, calendars: [],
        })),
      },
      calendarSource: {
        findMany: vi.fn(async () => [{
          ...writableCalendar(), visible: false, syncToken: null, updatedAt: now,
        }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({ id: 'calendar-1' })),
      },
      calendarSyncJob: { upsert: jobUpsert },
      user: { update: vi.fn() },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await setCalendarPreferences({
      ownerUserId: 'user-1', visibleCalendarIds: ['calendar-1'],
      crmDefaultCalendarId: 'calendar-1',
    }, db as never)

    expect(jobUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ operation: 'FULL_SYNC' }),
    }))
  })
})
