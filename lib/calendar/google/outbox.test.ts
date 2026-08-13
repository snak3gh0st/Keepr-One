import { describe, expect, it, vi } from 'vitest'
import { GoogleCalendarClient } from './client'
import { createGoogleEventIdempotently } from './outbox'

describe('Google Calendar durable outbound delivery', () => {
  it('recovers a provider 409 by reading the deterministic event id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { status: 'ALREADY_EXISTS' } }),
        { status: 409 },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'stable-id', etag: 'etag-1' })))
    const client = new GoogleCalendarClient({ accessToken: 'token', fetch: fetchMock as typeof fetch })
    const result = await createGoogleEventIdempotently(client, {
      calendarId: 'primary', eventId: 'stable-id', payload: { id: 'stable-id', summary: 'Meeting' },
      sendUpdates: 'all', conferenceDataVersion: 1,
    })
    expect(result).toMatchObject({ id: 'stable-id', etag: 'etag-1' })
    expect(String(fetchMock.mock.calls[1][0])).toContain('/events/stable-id')
    const createUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(createUrl.searchParams.get('sendUpdates')).toBe('all')
    expect(createUrl.searchParams.get('conferenceDataVersion')).toBe('1')
  })
})
