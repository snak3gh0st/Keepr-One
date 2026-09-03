import { describe, expect, it, vi } from 'vitest'
import { applyGoogleEvent, syncGoogleCalendarSource } from './sync'

const env = {
  clientId: 'client', clientSecret: 'secret',
  redirectUri: 'https://app.example.com/callback', webhookUrl: 'https://app.example.com/webhook',
  tokenKeyVersion: 'v1', tokenKeys: { v1: Buffer.alloc(32, 1).toString('base64') },
  workerId: 'worker-1', cronSecret: 'internal-secret-that-is-at-least-32-characters',
  workerIntervalSeconds: 15, reconcileIntervalSeconds: 300, schedulerDisabled: true,
}

function pendingEvent() {
  return {
    id: 'event-local',
    ownerUserId: 'user-1',
    insuranceCaseId: 'case-1',
    etag: 'etag-before-local-edit',
    title: 'Título editado no CRM',
    allDay: false,
    startsAt: new Date('2026-08-12T14:00:00.000Z'),
    endsAt: new Date('2026-08-12T14:30:00.000Z'),
    startDate: null,
    endDate: null,
    timeZone: 'America/New_York',
    status: 'CONFIRMED' as const,
    localRevision: 2,
    syncStatus: 'PENDING' as const,
    attendees: [],
  }
}

describe('Google inbound/local outbox race', () => {
  it('defers an inbound provider snapshot while a local mutation is pending', async () => {
    const update = vi.fn()
    const attendeeDelete = vi.fn()
    const timelineCreate = vi.fn()
    const tx = {
      calendarEvent: {
        findUnique: vi.fn(async () => pendingEvent()),
        update,
        create: vi.fn(),
      },
      calendarEventAttendee: { deleteMany: attendeeDelete, createMany: vi.fn() },
      caseTimelineEvent: { findMany: vi.fn(), create: timelineCreate },
      notification: { upsert: vi.fn() },
    }
    const transaction = vi.fn(async (run: (value: typeof tx) => unknown) => run(tx))
    const db = { $transaction: transaction }

    const result = await applyGoogleEvent(db as never, {
      ownerUserId: 'user-1',
      integrationId: 'integration-1',
      calendarId: 'calendar-1',
      now: new Date('2026-08-12T13:00:00.000Z'),
      event: {
        id: 'google-event',
        etag: 'etag-from-racing-push',
        summary: 'Título antigo do Google',
        status: 'confirmed',
        start: { dateTime: '2026-08-12T13:00:00-04:00' },
        end: { dateTime: '2026-08-12T13:30:00-04:00' },
      },
    })

    expect(result).toEqual({ changed: false, cancelled: false, deferred: true })
    expect(update).not.toHaveBeenCalled()
    expect(attendeeDelete).not.toHaveBeenCalled()
    expect(timelineCreate).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 30_000,
    })
  })

  it.each(['PROCESSING', 'ERROR'] as const)(
    'keeps the local snapshot authoritative while syncStatus=%s',
    async (syncStatus) => {
      const update = vi.fn()
      const tx = {
        calendarEvent: {
          findUnique: vi.fn(async () => ({ ...pendingEvent(), syncStatus })),
          update,
          create: vi.fn(),
        },
        calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
        caseTimelineEvent: { findMany: vi.fn(), create: vi.fn() },
        notification: { upsert: vi.fn() },
      }
      const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

      await applyGoogleEvent(db as never, {
        ownerUserId: 'user-1', integrationId: 'integration-1', calendarId: 'calendar-1',
        now: new Date('2026-08-12T13:00:00.000Z'),
        event: {
          id: 'google-event', etag: 'racing-etag', summary: 'Provider snapshot', status: 'confirmed',
          start: { dateTime: '2026-08-12T13:00:00-04:00' },
          end: { dateTime: '2026-08-12T13:30:00-04:00' },
        },
      })

      expect(update).not.toHaveBeenCalled()
    },
  )

  it('does not advance the Google sync token when a page was deferred', async () => {
    const sourceUpdate = vi.fn(async () => ({}))
    const event = {
      id: 'google-event', etag: 'racing-etag', summary: 'Provider snapshot', status: 'confirmed',
      start: { dateTime: '2026-08-12T13:00:00-04:00' },
      end: { dateTime: '2026-08-12T13:30:00-04:00' },
    }
    const tx = {
      calendarEvent: {
        findUnique: vi.fn(async () => pendingEvent()),
        update: vi.fn(), create: vi.fn(),
      },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      caseTimelineEvent: { findMany: vi.fn(), create: vi.fn() },
      notification: { upsert: vi.fn() },
    }
    const db = {
      calendarSource: {
        findUnique: vi.fn(async () => ({
          id: 'calendar-1', integrationId: 'integration-1', providerCalendarId: 'primary',
          syncToken: 'token-before-race', integration: { userId: 'user-1', status: 'CONNECTED' },
        })),
        update: sourceUpdate,
      },
      calendarIntegration: {
        findUnique: vi.fn(async () => ({
          id: 'integration-1', userId: 'user-1', status: 'CONNECTED',
          accessTokenKeyVersion: 'v1', accessTokenAlgorithm: 'aes-256-gcm',
          accessTokenIv: 'iv', accessTokenCiphertext: 'cipher', accessTokenAuthTag: 'tag',
          refreshTokenKeyVersion: null, refreshTokenAlgorithm: null, refreshTokenIv: null,
          refreshTokenCiphertext: null, refreshTokenAuthTag: null, tokenExpiresAt: null,
          providerAccountId: 'google-1',
        })),
        update: vi.fn(async () => ({})),
      },
      calendarSyncJob: { create: vi.fn(), upsert: vi.fn() },
      $transaction: async (run: (value: typeof tx) => unknown) => run(tx),
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/calendar/v3/calendars/primary/events')) {
        return new Response(JSON.stringify({ items: [event], nextSyncToken: 'token-after-race' }))
      }
      throw new Error(`Unexpected request ${url}`)
    })

    // The credential decryption is intentionally exercised by its own tests;
    // inject a valid encrypted access token for this sync-level invariant.
    const { encryptGoogleSecret } = await import('./crypto')
    const encrypted = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-1', providerAccountId: 'google-1',
      tokenKind: 'access',
    }, env)
    db.calendarIntegration.findUnique.mockResolvedValueOnce({
      id: 'integration-1', userId: 'user-1', status: 'CONNECTED', providerAccountId: 'google-1',
      accessKeyVersion: encrypted.keyVersion, accessAlgorithm: encrypted.algorithm,
      accessIv: encrypted.iv, accessCiphertext: encrypted.ciphertext,
      accessAuthTag: encrypted.authTag, refreshKeyVersion: null,
      refreshAlgorithm: null, refreshIv: null, refreshCiphertext: null,
      refreshAuthTag: null, tokenExpiresAt: new Date('2026-08-12T15:00:00.000Z'),
    } as never)

    const report = await syncGoogleCalendarSource('calendar-1', env as never, {
      db: db as never,
      fetch: fetchMock as typeof fetch,
      now: new Date('2026-08-12T13:00:00.000Z'),
    })

    expect(report).toMatchObject({ deferred: 1, nextSyncToken: null })
    expect(sourceUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ syncToken: null, syncStatus: 'PENDING' }),
    }))
  })

  it('records inbound schedule deltas and attendee responses in Portuguese with a dedupe key', async () => {
    const timelineCreate = vi.fn(async () => ({ id: 'timeline-1' }))
    const notificationUpsert = vi.fn(async () => ({ id: 'notification-1' }))
    const tx = {
      calendarEvent: {
        findUnique: vi.fn(async () => ({
          ...pendingEvent(),
          syncStatus: 'SYNCED' as const,
          startsAt: new Date('2026-08-15T18:00:00.000Z'),
          endsAt: new Date('2026-08-15T19:00:00.000Z'),
          attendees: [{ email: 'ana@example.com', responseStatus: 'NEEDS_ACTION' }],
        })),
        update: vi.fn(async () => ({})),
        create: vi.fn(),
      },
      calendarEventAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
      caseTimelineEvent: { findMany: vi.fn(async () => []), create: timelineCreate },
      notification: { upsert: notificationUpsert },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await applyGoogleEvent(db as never, {
      ownerUserId: 'user-1', integrationId: 'integration-1', calendarId: 'calendar-1',
      now: new Date('2026-08-12T13:00:00.000Z'),
      event: {
        id: 'google-event', etag: 'etag-new', summary: 'Reunião com Ana', status: 'confirmed',
        start: { dateTime: '2026-08-16T15:00:00-04:00', timeZone: 'America/New_York' },
        end: { dateTime: '2026-08-16T16:00:00-04:00', timeZone: 'America/New_York' },
        attendees: [{ email: 'ana@example.com', responseStatus: 'accepted' }],
      },
    })

    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'MEETING_UPDATED_FROM_GOOGLE',
        body: 'Reunião com Ana · De 15/08/2026, 14:00 para 16/08/2026, 15:00.',
        metadata: expect.objectContaining({ eventKey: expect.any(String) }),
      }),
    }))
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'MEETING_ATTENDEE_RESPONSE',
        body: 'ana@example.com confirmou presença.',
        metadata: expect.objectContaining({ eventKey: expect.any(String) }),
      }),
    }))
    expect(notificationUpsert).toHaveBeenCalledTimes(2)
  })

})
