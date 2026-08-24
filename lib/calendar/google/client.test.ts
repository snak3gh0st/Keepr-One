import { describe, expect, it, vi } from 'vitest'
import { GoogleCalendarClient } from './client'
import { GoogleSyncTokenExpiredError } from './errors'

describe('GoogleCalendarClient', () => {
  it('paginates all event pages and commits only the terminal sync token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'one' }], nextPageToken: 'p2' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'two' }], nextSyncToken: 'sync-final' })))
    const pages: string[][] = []
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    const token = await client.listEventPages({ calendarId: 'primary', onPage: async (items) => { pages.push(items.map((item) => item.id)) } })
    expect(pages).toEqual([['one'], ['two']])
    expect(token).toBe('sync-final')
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2')
    expect(String(fetchMock.mock.calls[0][0])).toContain('singleEvents=true')
  })

  it('raises a typed 410 for expired sync tokens', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 410 } }), { status: 410 }))
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    await expect(client.listEventPages({ calendarId: 'primary', syncToken: 'expired', onPage: async () => {} }))
      .rejects.toBeInstanceOf(GoogleSyncTokenExpiredError)
  })

  it('uses sendUpdates and conferenceDataVersion for invite + Meet semantics', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args
      return new Response(JSON.stringify({ id: 'event-id' }))
    })
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    await client.createEvent('work@example.com', { summary: 'Meeting' }, { sendUpdates: 'all', conferenceDataVersion: 1 })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('sendUpdates')).toBe('all')
    expect(url.searchParams.get('conferenceDataVersion')).toBe('1')
  })

  it('recovers a duplicate create by reading the client-generated event id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'ALREADY_EXISTS' } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'stable-event', etag: 'etag-1' })))
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    let recovered
    try {
      await client.createEvent('primary', { id: 'stable-event', summary: 'Meeting' })
    } catch {
      recovered = await client.getEvent('primary', 'stable-event')
    }
    expect(recovered).toMatchObject({ id: 'stable-event', etag: 'etag-1' })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/events/stable-event')
  })

  it('uses exact CalendarList and FreeBusy contracts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'primary' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ timeMin: 'a', timeMax: 'b', calendars: {} })))
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    await client.listCalendars()
    await client.freeBusy({ timeMin: '2026-08-12T00:00:00Z', timeMax: '2026-08-13T00:00:00Z', calendarIds: ['primary'] })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/users/me/calendarList')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ items: [{ id: 'primary' }] })
  })

  it('moves an event through Events.move when its calendar changes', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args
      return new Response(JSON.stringify({ id: 'event-id', etag: 'moved-etag' }))
    })
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    await client.moveEvent('old@example.com', 'event-id', 'new@example.com', { sendUpdates: 'all' })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toContain('/calendars/old%40example.com/events/event-id/move')
    expect(url.searchParams.get('destination')).toBe('new@example.com')
    expect(url.searchParams.get('sendUpdates')).toBe('all')
  })
})
