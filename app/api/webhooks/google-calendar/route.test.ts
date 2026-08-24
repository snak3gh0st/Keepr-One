import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ accept: vi.fn(), capture: vi.fn() }))

vi.mock('@/lib/calendar/google/watch', () => ({
  acceptGoogleWebhook: mocks.accept,
  readGoogleWebhookHeaders: (headers: Headers) => ({
    channelId: headers.get('x-goog-channel-id'),
    resourceId: headers.get('x-goog-resource-id'),
    resourceState: headers.get('x-goog-resource-state'),
    messageNumber: headers.get('x-goog-message-number'),
    channelToken: headers.get('x-goog-channel-token'),
    channelExpiration: headers.get('x-goog-channel-expiration'),
  }),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }))

import { POST } from './route'

beforeEach(() => vi.clearAllMocks())

describe('Google Calendar webhook route', () => {
  it('returns immediately with no body after enqueueing a valid wake-up', async () => {
    mocks.accept.mockResolvedValue({ accepted: true, duplicate: false, calendarId: 'calendar' })
    const response = await POST(new Request('https://app.example.com/api/webhooks/google-calendar', {
      method: 'POST',
      headers: {
        'x-goog-channel-id': 'channel', 'x-goog-resource-id': 'resource',
        'x-goog-message-number': '10', 'x-goog-channel-token': 'secret',
      },
    }))
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.accept).toHaveBeenCalledTimes(1)
  })

  it('does not disclose whether a forged channel id or token was close to valid', async () => {
    mocks.accept.mockResolvedValue(null)
    const response = await POST(new Request('https://app.example.com/api/webhooks/google-calendar', {
      method: 'POST', headers: { 'x-goog-channel-id': 'forged' },
    }))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })
})
