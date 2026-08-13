import { describe, expect, it, vi } from 'vitest'
import { applyGoogleEvent, sweepMissingGoogleEventsFromFullSync } from './sync'

const now = new Date('2026-08-12T16:00:00.000Z')
const range = {
  timeMin: '2026-02-13T16:00:00.000Z',
  timeMax: '2028-08-11T16:00:00.000Z',
}

function projectedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'local-missing',
    integrationId: 'integration-1',
    insuranceCaseId: 'case-1',
    providerEventId: 'google-event-missing',
    iCalUid: 'stable-ical@example.com',
    allDay: false,
    startsAt: new Date('2026-08-20T14:00:00.000Z'),
    endsAt: new Date('2026-08-20T15:00:00.000Z'),
    startDate: null,
    endDate: null,
    syncStatus: 'SYNCED' as const,
    ...overrides,
  }
}

describe('bounded Google full-sync sweep', () => {
  it('tombstones a synchronized Google projection missing inside the covered window only', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const findMany = vi.fn(async () => [
      projectedEvent(),
      projectedEvent({ id: 'present', providerEventId: 'google-event-present' }),
      projectedEvent({ id: 'local-pending', providerEventId: 'pending', syncStatus: 'PENDING' }),
    ])
    const tx = {
      calendarEvent: {
        findMany,
        findFirst: vi.fn(async () => null),
        updateMany,
      },
      notification: { updateMany: vi.fn(async () => ({ count: 0 })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const result = await sweepMissingGoogleEventsFromFullSync(db as never, {
      calendarId: 'calendar-source-1',
      ...range,
      seenProviderEventIds: new Set(['google-event-present']),
      now,
    })

    expect(result).toEqual({ cancelled: 1, preservedLocal: 1, associationsTransferred: 0 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        calendarId: 'calendar-source-1',
        source: 'GOOGLE',
        recurrence: { isEmpty: true },
        OR: expect.arrayContaining([
          expect.objectContaining({
            allDay: false,
            startsAt: { gte: new Date(range.timeMin) },
            endsAt: { lte: new Date(range.timeMax) },
          }),
        ]),
      }),
    }))
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'local-missing', source: 'GOOGLE', syncStatus: 'SYNCED' }),
      data: expect.objectContaining({ status: 'CANCELLED', deletedAt: now }),
    }))
  })

  it('transfers a lead association and retires the old projection when Google moved an event', async () => {
    const create = vi.fn(async (input: { data: Record<string, unknown> }) => ({
      id: 'destination-projection',
      ...input.data,
    }))
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      calendarEvent: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => ({ id: 'source-projection', insuranceCaseId: 'case-1' })),
        create,
        updateMany,
      },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      caseTimelineEvent: { findMany: vi.fn(), create: vi.fn() },
      notification: { upsert: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const result = await applyGoogleEvent(db as never, {
      ownerUserId: 'user-1',
      integrationId: 'integration-1',
      calendarId: 'destination-calendar',
      now,
      event: {
        id: 'stable-provider-id',
        iCalUID: 'stable-ical@example.com',
        etag: 'destination-etag',
        summary: 'Review meeting',
        status: 'confirmed',
        start: { dateTime: '2026-08-20T10:00:00-04:00' },
        end: { dateTime: '2026-08-20T11:00:00-04:00' },
      },
    })

    expect(result).toEqual({ changed: true, cancelled: false })
    expect(tx.calendarEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        calendarId: { not: 'destination-calendar' },
        source: 'GOOGLE',
        providerEventId: 'stable-provider-id',
        iCalUid: 'stable-ical@example.com',
      }),
    }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        calendarId: 'destination-calendar',
        insuranceCaseId: 'case-1',
        providerEventId: 'stable-provider-id',
      }),
    }))
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'source-projection', source: 'GOOGLE' }),
      data: expect.objectContaining({ status: 'CANCELLED', deletedAt: now }),
    }))
  })
})
