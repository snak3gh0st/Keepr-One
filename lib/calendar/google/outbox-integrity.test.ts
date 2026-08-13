import { describe, expect, it, vi } from 'vitest'
import type { CalendarSyncJob } from '@prisma/client'
import { encryptGoogleSecret } from './crypto'
import { processOutboundEvent } from './outbox'

const env = {
  clientId: 'client', clientSecret: 'secret',
  redirectUri: 'https://app.example.com/callback', webhookUrl: 'https://app.example.com/webhook',
  tokenKeyVersion: 'v1', tokenKeys: { v1: Buffer.alloc(32, 4).toString('base64') },
  workerId: 'worker-1', workerIntervalSeconds: 15, reconcileIntervalSeconds: 300,
  schedulerDisabled: true,
}

function job(overrides: Partial<CalendarSyncJob> = {}): CalendarSyncJob {
  const now = new Date('2026-08-12T13:00:00.000Z')
  return {
    id: 'job-1', integrationId: 'integration-1', calendarId: 'calendar-1', eventId: 'event-1',
    direction: 'OUTBOUND', operation: 'UPDATE_EVENT', status: 'PROCESSING', desiredRevision: 2,
    sendInvites: false, payload: null, attempts: 1, availableAt: now, leaseOwner: 'worker-1',
    leaseExpiresAt: new Date('2026-08-12T13:01:00.000Z'), idempotencyKey: 'job-1',
    lastErrorCode: null, createdAt: now, updatedAt: now,
    ...overrides,
  }
}

function localEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1', ownerUserId: 'user-1', integrationId: 'integration-1', calendarId: 'calendar-1',
    insuranceCaseId: null, providerEventId: 'google-event', providerRecurringEventId: null,
    providerOriginalStartAt: null, providerOriginalStartDate: null, recurrence: [], iCalUid: null,
    etag: 'etag-old', sequence: 1, title: 'Edição local', description: null,
    startsAt: new Date('2026-08-12T14:00:00.000Z'), endsAt: new Date('2026-08-12T14:30:00.000Z'),
    startDate: null, endDate: null, timeZone: 'America/New_York', allDay: false, location: null,
    meetingUrl: null, conferenceData: null, reminders: null, colorId: null, visibility: null,
    transparency: null, status: 'CONFIRMED', source: 'CRM', syncStatus: 'PENDING', syncErrorCode: null,
    providerUpdatedAt: null, deletedAt: null, lastSyncedAt: null, localRevision: 2,
    createdAt: new Date('2026-08-12T12:00:00.000Z'), updatedAt: new Date('2026-08-12T13:00:00.000Z'),
    calendar: { id: 'calendar-1', providerCalendarId: 'primary' }, attendees: [],
    ...overrides,
  }
}

describe('outbox revision acknowledgement', () => {
  it('persists provider acknowledgement only against the job desiredRevision', async () => {
    const encrypted = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-1', providerAccountId: 'google-1', tokenKind: 'access',
    }, env)
    const acknowledge = vi.fn(async () => ({ count: 0 }))
    const db = {
      calendarEvent: { findUnique: vi.fn(async () => localEvent()), updateMany: acknowledge },
      calendarSource: { findFirst: vi.fn() },
      calendarWatchChannel: {},
      calendarSyncJob: {},
      calendarIntegration: {
        findUnique: vi.fn(async () => ({
          id: 'integration-1', userId: 'user-1', providerAccountId: 'google-1', provider: 'GOOGLE',
          providerEmail: 'agent@example.com', displayName: null, status: 'CONNECTED', grantedScopes: [],
          accessKeyVersion: encrypted.keyVersion, accessAlgorithm: encrypted.algorithm,
          accessIv: encrypted.iv, accessCiphertext: encrypted.ciphertext, accessAuthTag: encrypted.authTag,
          refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null, refreshCiphertext: null,
          refreshAuthTag: null, tokenExpiresAt: new Date('2026-08-12T15:00:00.000Z'),
          connectedAt: new Date(), disconnectedAt: null, lastSyncAt: null, lastErrorCode: null,
          createdAt: new Date(), updatedAt: new Date(),
        })),
      },
      $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args
      return new Response(JSON.stringify({
        id: 'google-event', etag: 'etag-ack', updated: '2026-08-12T13:00:02.000Z',
      }))
    })

    await processOutboundEvent(job(), env, {
      db: db as never,
      fetch: fetchMock as typeof fetch,
      accessToken: 'access-token',
    })

    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'event-1', localRevision: 2 },
      data: expect.objectContaining({ syncStatus: 'SYNCED', etag: 'etag-ack' }),
    }))
  })

  it('patches revision 2 after revision 1 was created but its response was lost', async () => {
    const acknowledge = vi.fn(async () => ({ count: 1 }))
    const db = {
      calendarEvent: {
        findUnique: vi.fn(async () => localEvent({
          providerEventId: 'reserved-google-id',
          etag: null,
          lastSyncedAt: null,
          providerUpdatedAt: null,
        })),
        updateMany: acknowledge,
      },
      calendarSource: { findFirst: vi.fn() },
      calendarWatchChannel: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi
      .fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return new Response()
      })
      // Revision 1 exists remotely because its successful response was lost.
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { status: 'ALREADY_EXISTS' } }),
        { status: 409 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'reserved-google-id', etag: 'etag-revision-1', summary: 'Revisão 1',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'reserved-google-id', etag: 'etag-revision-2', summary: 'Edição local',
        updated: '2026-08-12T13:00:02.000Z',
      })))

    await processOutboundEvent(job(), env, {
      db: db as never,
      fetch: fetchMock as typeof fetch,
      accessToken: 'access-token',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/calendars/primary/events')
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'If-Match': 'etag-revision-1' }),
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({
      summary: 'Edição local',
    })
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'event-1', localRevision: 2 },
      data: expect.objectContaining({
        providerEventId: 'reserved-google-id', etag: 'etag-revision-2', syncStatus: 'SYNCED',
      }),
    }))
  })

  it('moves an unconfirmed earlier create before patching the edited revision', async () => {
    const acknowledge = vi.fn(async () => ({ count: 1 }))
    const db = {
      calendarEvent: {
        findUnique: vi.fn(async () => localEvent({
          calendarId: 'calendar-2',
          calendar: { id: 'calendar-2', providerCalendarId: 'destination' },
          providerEventId: 'reserved-google-id',
          etag: null,
          lastSyncedAt: null,
          providerUpdatedAt: null,
        })),
        updateMany: acknowledge,
      },
      calendarSource: {
        findFirst: vi.fn(async () => ({ providerCalendarId: 'origin' })),
      },
      calendarWatchChannel: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi
      .fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return new Response()
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'reserved-google-id', etag: 'etag-moved', summary: 'Revisão 1',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'reserved-google-id', etag: 'etag-revision-2', summary: 'Edição local',
      })))

    await processOutboundEvent(job({
      calendarId: 'calendar-2',
      payload: { previousCalendarId: 'calendar-1' },
    }), env, {
      db: db as never,
      fetch: fetchMock as typeof fetch,
      accessToken: 'access-token',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/calendars/origin/events/reserved-google-id/move')
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('destination')).toBe('destination')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'If-Match': 'etag-moved' }),
    })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'event-1', localRevision: 2 },
      data: expect.objectContaining({ etag: 'etag-revision-2', syncStatus: 'SYNCED' }),
    }))
  })

  it('resumes patching in the destination when a previous move already succeeded', async () => {
    const acknowledge = vi.fn(async () => ({ count: 1 }))
    const db = {
      calendarEvent: {
        findUnique: vi.fn(async () => localEvent({
          calendarId: 'calendar-2',
          calendar: { id: 'calendar-2', providerCalendarId: 'destination' },
          lastSyncedAt: new Date('2026-08-12T12:30:00.000Z'),
        })),
        updateMany: acknowledge,
      },
      calendarSource: {
        findFirst: vi.fn(async () => ({ providerCalendarId: 'origin' })),
      },
      calendarWatchChannel: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi
      .fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
        void args
        return new Response()
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'google-event', etag: 'etag-moved' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'google-event', etag: 'etag-patched', updated: '2026-08-12T13:00:03.000Z',
      })))

    await processOutboundEvent(job({
      calendarId: 'calendar-2',
      payload: { previousCalendarId: 'calendar-1' },
    }), env, {
      db: db as never,
      fetch: fetchMock as typeof fetch,
      accessToken: 'access-token',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/calendars/origin/events/google-event/move')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/calendars/destination/events/google-event')
    expect(fetchMock.mock.calls[2][1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'If-Match': 'etag-moved' }),
    })
    expect(acknowledge).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ etag: 'etag-patched', syncStatus: 'SYNCED' }),
    }))
  })
})
