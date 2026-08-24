import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCalendarUser: vi.fn(),
  sameOrigin: vi.fn(),
  integrationFindUnique: vi.fn(),
  disconnect: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))
vi.mock('@/lib/calendar/google/route-auth', () => ({ requireCalendarUser: mocks.requireCalendarUser }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/calendar/google/env', () => ({ getGoogleCalendarEnv: vi.fn(() => ({})) }))
vi.mock('@/lib/calendar/google/credentials', () => ({
  disconnectGoogleCalendarLocally: mocks.disconnect,
  readGoogleRefreshToken: vi.fn(),
}))
vi.mock('@/lib/calendar/google/oauth', () => ({ revokeGoogleToken: vi.fn() }))
vi.mock('@/lib/calendar/google/watch', () => ({ stopGoogleCalendarWatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarIntegration: { findUnique: mocks.integrationFindUnique },
    calendarWatchChannel: { findMany: vi.fn() },
  },
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCalendarUser.mockResolvedValue({ userId: 'owner-1' })
  mocks.integrationFindUnique.mockResolvedValue(null)
})

describe('Google Calendar disconnect same-origin boundary', () => {
  it('rejects cross-origin before authentication or credential access', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('bad origin') })
    const response = await POST(new Request('https://app.keepr.one/api/agent/integrations/google-calendar/disconnect', { method: 'POST' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'FORBIDDEN' })
    expect(mocks.requireCalendarUser).not.toHaveBeenCalled()
    expect(mocks.integrationFindUnique).not.toHaveBeenCalled()
  })

  it('allows same-origin authenticated disconnect when no integration remains', async () => {
    const response = await POST(new Request('https://app.keepr.one/api/agent/integrations/google-calendar/disconnect', {
      method: 'POST',
      headers: { origin: 'https://app.keepr.one', host: 'app.keepr.one' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ disconnected: true })
    expect(mocks.requireCalendarUser).toHaveBeenCalledOnce()
    expect(mocks.integrationFindUnique).toHaveBeenCalledOnce()
  })
})
