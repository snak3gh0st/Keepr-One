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
        { id: 'source-a', providerCalendarId: 'work@example.com' },
        { id: 'source-primary', providerCalendarId: 'primary@example.com' },
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
          { id: 'source-a', providerCalendarId: 'work@example.com' },
          { id: 'source-b', providerCalendarId: 'personal@example.com' },
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
})
