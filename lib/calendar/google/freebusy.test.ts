import { describe, expect, it, vi } from 'vitest'
import type { GoogleCalendarEnv } from './env'
import { encryptGoogleSecret } from './crypto'
import { getGoogleFreeBusyForUser } from './freebusy'

const env: GoogleCalendarEnv = {
  clientId: 'client', clientSecret: 'secret',
  redirectUri: 'https://app.example.com/callback', webhookUrl: 'https://app.example.com/webhook',
  tokenKeyVersion: 'v1', tokenKeys: { v1: Buffer.alloc(32, 9).toString('base64') },
  workerId: 'worker', workerIntervalSeconds: 15, reconcileIntervalSeconds: 300,
  schedulerDisabled: false,
}

describe('live Google availability', () => {
  it('queries only the owning user calendars and maps provider busy intervals', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const integration = {
      id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
      tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
      accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
      accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
      refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
      refreshCiphertext: null, refreshAuthTag: null,
      calendars: [
        { id: 'source-a', providerCalendarId: 'work@example.com', timeZone: 'America/New_York' },
        { id: 'source-primary', providerCalendarId: 'primary@example.com', timeZone: 'America/New_York' },
      ],
    }
    const findUnique = vi.fn(async () => integration)
    const db = {
      calendarIntegration: { findUnique },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const body = JSON.parse(String(args[1]?.body)) as { items: Array<{ id: string }> }
      expect(body.items).toEqual([
        { id: 'work@example.com' },
        { id: 'primary@example.com' },
      ])
      return new Response(JSON.stringify({
        timeMin: '2026-08-12T14:00:00Z', timeMax: '2026-08-12T18:00:00Z',
        calendars: {
          'work@example.com': { busy: [{
            start: '2026-08-12T15:00:00Z', end: '2026-08-12T16:00:00Z',
          }] },
          'primary@example.com': { busy: [] },
        },
      }))
    })
    const result = await getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T14:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'America/New_York',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })
    expect(result.connected).toBe(true)
    expect(result.intervals).toEqual([expect.objectContaining({
      calendarSourceId: 'source-a', providerCalendarId: 'work@example.com',
      start: new Date('2026-08-12T15:00:00Z'), end: new Date('2026-08-12T16:00:00Z'),
    })])
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        calendars: expect.objectContaining({
          where: { OR: [{ visible: true }, { crmDefault: true }] },
        }),
      }),
    }))
  })

  it('fails closed when Google omits one of the selected calendars', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [
          { id: 'source-a', providerCalendarId: 'work@example.com', timeZone: 'America/New_York' },
          { id: 'source-b', providerCalendarId: 'personal@example.com', timeZone: 'America/New_York' },
        ],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      timeMin: '2026-08-12T14:00:00Z', timeMax: '2026-08-12T18:00:00Z',
      calendars: { 'work@example.com': { busy: [] } },
    })))

    await expect(getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T14:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'America/New_York',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })).rejects.toThrow(
      'Google FreeBusy omitted calendar personal@example.com',
    )
  })

  it('falls back to a live events range when a subscribed calendar rejects freeBusy', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [
          { id: 'source-primary', providerCalendarId: 'primary@example.com', timeZone: 'America/New_York' },
          // Simulate a stale value persisted before the Google calendar changed timezone.
          { id: 'source-holiday', providerCalendarId: 'holiday@example.com', timeZone: 'America/Los_Angeles' },
        ],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      if (url.endsWith('/freeBusy')) {
        return new Response(JSON.stringify({
          timeMin: '2026-08-12T04:00:00Z', timeMax: '2026-08-13T04:00:00Z',
          calendars: {
            'primary@example.com': { busy: [] },
            'holiday@example.com': { errors: [{ reason: 'notFound' }], busy: [] },
          },
        }))
      }
      expect(url).toContain('/calendars/holiday%40example.com/events')
      return new Response(JSON.stringify({ timeZone: 'America/New_York', items: [
        {
          id: 'opaque-all-day', status: 'confirmed',
          start: { date: '2026-08-12' }, end: { date: '2026-08-13' },
        },
        {
          id: 'transparent-event', status: 'confirmed', transparency: 'transparent',
          start: { dateTime: '2026-08-12T15:00:00Z' },
          end: { dateTime: '2026-08-12T16:00:00Z' },
        },
        {
          id: 'declined-event', status: 'confirmed',
          start: { dateTime: '2026-08-12T17:00:00Z' },
          end: { dateTime: '2026-08-12T18:00:00Z' },
          attendees: [{ email: 'agent@example.com', self: true, responseStatus: 'declined' }],
        },
      ] }))
    })

    const result = await getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T04:00:00Z'),
      end: new Date('2026-08-13T04:00:00Z'), timeZone: 'America/New_York',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })

    expect(result.connected).toBe(true)
    expect(result.intervals).toEqual([{
      calendarSourceId: 'source-holiday',
      providerCalendarId: 'holiday@example.com',
      start: new Date('2026-08-12T04:00:00Z'),
      end: new Date('2026-08-13T04:00:00Z'),
    }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('interprets offset-less fallback events in the provider time zone', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [{ id: 'source-a', providerCalendarId: 'shared@example.com', timeZone: null }],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        calendars: { 'shared@example.com': { errors: [{ reason: 'notFound' }] } },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        timeZone: 'America/Los_Angeles',
        items: [{
          id: 'local-wall-clock', status: 'confirmed',
          start: { dateTime: '2026-08-12T09:00:00', timeZone: 'America/Los_Angeles' },
          end: { dateTime: '2026-08-12T13:00:00', timeZone: 'America/New_York' },
        }],
      })))

    const result = await getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T15:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'UTC',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })

    expect(result.intervals).toEqual([expect.objectContaining({
      start: new Date('2026-08-12T16:00:00Z'),
      end: new Date('2026-08-12T17:00:00Z'),
    })])
  })

  it('still fails closed for provider errors other than notFound', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [{ id: 'source-a', providerCalendarId: 'work@example.com', timeZone: 'UTC' }],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      timeMin: '2026-08-12T14:00:00Z', timeMax: '2026-08-12T18:00:00Z',
      calendars: { 'work@example.com': { errors: [{ reason: 'internalError' }] } },
    })))

    await expect(getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T14:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'UTC',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })).rejects.toThrow(
      'Google FreeBusy failed for calendar work@example.com',
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('omits Google system calendars while retaining real conflict calendars', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [
          { id: 'holiday-source', providerCalendarId: 'en.usa#holiday@group.v.calendar.google.com' },
          { id: 'read-only-source', providerCalendarId: 'team@example.com' },
          { id: 'primary-source', providerCalendarId: 'primary@example.com' },
        ],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const body = JSON.parse(String(args[1]?.body)) as { items: Array<{ id: string }> }
      expect(body.items).toEqual([
        { id: 'team@example.com' },
        { id: 'primary@example.com' },
      ])
      return new Response(JSON.stringify({
        calendars: {
          'team@example.com': { busy: [] },
          'primary@example.com': { busy: [] },
        },
      }))
    })

    await expect(getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T14:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'America/New_York',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })).resolves.toEqual({
      connected: true,
      intervals: [],
    })
  })

  it('fails closed when a retained real conflict calendar returns an error', async () => {
    const access = encryptGoogleSecret('access-token', {
      purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a',
      tokenKind: 'access',
    }, env)
    const db = {
      calendarIntegration: { findUnique: vi.fn(async () => ({
        id: 'integration-a', userId: 'user-a', providerAccountId: 'google-a', status: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
        tokenExpiresAt: new Date('2099-08-13T00:00:00Z'),
        accessKeyVersion: access.keyVersion, accessAlgorithm: access.algorithm,
        accessIv: access.iv, accessCiphertext: access.ciphertext, accessAuthTag: access.authTag,
        refreshKeyVersion: null, refreshAlgorithm: null, refreshIv: null,
        refreshCiphertext: null, refreshAuthTag: null,
        calendars: [
          { id: 'holiday-source', providerCalendarId: 'en.usa#holiday@group.v.calendar.google.com' },
          { id: 'real-source', providerCalendarId: 'conflicts@example.com' },
        ],
      })) },
      calendarSource: {}, calendarSyncJob: {}, $transaction: vi.fn(),
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'conflicts@example.com': { errors: [{ reason: 'internalError' }] } },
    })))

    await expect(getGoogleFreeBusyForUser({
      ownerUserId: 'user-a', start: new Date('2026-08-12T14:00:00Z'),
      end: new Date('2026-08-12T18:00:00Z'), timeZone: 'America/New_York',
    }, env, { db: db as never, fetch: fetchMock as typeof fetch })).rejects.toThrow(
      'Google FreeBusy failed for calendar conflicts@example.com',
    )
  })
})
