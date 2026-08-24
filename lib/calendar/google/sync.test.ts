import { describe, expect, it, vi } from 'vitest'
import { GoogleSyncTokenExpiredError } from './errors'
import { listGoogleEventPagesWith410Recovery } from './sync'
import type { GoogleCalendarEvent } from './types'

describe('Google incremental synchronization', () => {
  it('clears an expired sync token and replaces it only after a bounded full pass', async () => {
    const onPage = vi.fn(async (...events: GoogleCalendarEvent[][]) => { void events })
    const onExpiredToken = vi.fn(async () => {})
    const listEventPages = vi
      .fn(async (...inputs: Array<{ onPage: typeof onPage }>) => { void inputs; return 'unused-token' })
      .mockRejectedValueOnce(new GoogleSyncTokenExpiredError())
      .mockImplementationOnce(async (input: { onPage: typeof onPage }) => {
        await input.onPage([{
          id: 'weekly_20260817T130000Z', recurringEventId: 'weekly', status: 'confirmed',
          originalStartTime: { dateTime: '2026-08-17T09:00:00-04:00' },
          start: { dateTime: '2026-08-17T09:00:00-04:00' },
          end: { dateTime: '2026-08-17T10:00:00-04:00' },
        }])
        return 'replacement-token'
      })
    const result = await listGoogleEventPagesWith410Recovery({
      client: { listEventPages } as never,
      calendarId: 'primary', syncToken: 'expired-token',
      timeMin: '2026-02-01T00:00:00.000Z', timeMax: '2028-08-01T00:00:00.000Z',
      onPage, onExpiredToken,
    })
    expect(result).toEqual({ nextSyncToken: 'replacement-token', reset: true })
    expect(onExpiredToken).toHaveBeenCalledTimes(1)
    expect(listEventPages).toHaveBeenNthCalledWith(1, expect.objectContaining({
      syncToken: 'expired-token', singleEvents: true,
    }))
    expect(listEventPages).toHaveBeenNthCalledWith(2, expect.objectContaining({
      syncToken: null, singleEvents: true,
      timeMin: '2026-02-01T00:00:00.000Z', timeMax: '2028-08-01T00:00:00.000Z',
    }))
    expect(onPage).toHaveBeenCalledWith([expect.objectContaining({
      recurringEventId: 'weekly',
    })])
  })
})
