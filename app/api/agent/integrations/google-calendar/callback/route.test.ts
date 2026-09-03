import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  requireCalendarUser: vi.fn(),
  getGoogleCalendarEnv: vi.fn(),
  consumeGoogleOAuthState: vi.fn(),
  exchangeGoogleAuthorizationCode: vi.fn(),
  missingGoogleCalendarScopes: vi.fn(),
  getGoogleUserInfo: vi.fn(),
  saveGoogleCalendarConnection: vi.fn(),
  syncGoogleCalendarList: vi.fn(),
  enqueueInitialGoogleCalendarSyncs: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))
vi.mock('@/lib/calendar/google/route-auth', () => ({
  requireCalendarUser: mocks.requireCalendarUser,
  safeCalendarReturnTo: (value: string | null, fallback = '/agent/calendar') =>
    value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
      ? value
      : fallback,
}))
vi.mock('@/lib/calendar/google/env', () => ({
  getGoogleCalendarEnv: mocks.getGoogleCalendarEnv,
}))
vi.mock('@/lib/calendar/google/oauth-state', () => ({
  consumeGoogleOAuthState: mocks.consumeGoogleOAuthState,
}))
vi.mock('@/lib/calendar/google/oauth', () => ({
  exchangeGoogleAuthorizationCode: mocks.exchangeGoogleAuthorizationCode,
  getGoogleUserInfo: mocks.getGoogleUserInfo,
  missingGoogleCalendarScopes: mocks.missingGoogleCalendarScopes,
}))
vi.mock('@/lib/calendar/google/credentials', () => ({
  saveGoogleCalendarConnection: mocks.saveGoogleCalendarConnection,
}))
vi.mock('@/lib/calendar/google/sync', () => ({
  syncGoogleCalendarList: mocks.syncGoogleCalendarList,
}))
vi.mock('@/lib/calendar/google/source-selection', () => ({
  enqueueInitialGoogleCalendarSyncs: mocks.enqueueInitialGoogleCalendarSyncs,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCalendarUser.mockResolvedValue({
    userId: 'user-1',
    sessionId: 'session-1',
  })
  mocks.getGoogleCalendarEnv.mockReturnValue({ clientId: 'client-id' })
  mocks.consumeGoogleOAuthState.mockResolvedValue({
    codeVerifier: 'verifier-1',
    returnTo: '/onboarding',
  })
  mocks.exchangeGoogleAuthorizationCode.mockResolvedValue({
    access_token: 'access-token',
    scope: 'calendar.events calendar.calendarlist.readonly',
  })
  mocks.missingGoogleCalendarScopes.mockReturnValue([])
  mocks.getGoogleUserInfo.mockResolvedValue({
    email: 'agent@example.com',
    email_verified: true,
  })
  mocks.saveGoogleCalendarConnection.mockResolvedValue({
    id: 'integration-1',
    connectedAt: new Date('2026-09-03T12:00:00.000Z'),
  })
  mocks.syncGoogleCalendarList.mockResolvedValue([])
})

describe('Google Calendar OAuth callback', () => {
  it('rejects a callback without a complete OAuth response', async () => {
    const response = await GET(new Request(
      'https://app.keepr.one/api/agent/integrations/google-calendar/callback?state=state-1',
    ))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_OAUTH_CALLBACK' })
    expect(mocks.requireCalendarUser).not.toHaveBeenCalled()
  })

  it('preserves the consumed onboarding return path when a later OAuth step fails', async () => {
    const failure = new Error('token exchange failed')
    mocks.exchangeGoogleAuthorizationCode.mockRejectedValue(failure)

    const response = await GET(new Request(
      'https://app.keepr.one/api/agent/integrations/google-calendar/callback?state=state-1&code=code-1',
    ))

    expect(mocks.consumeGoogleOAuthState).toHaveBeenCalledWith(
      {
        state: 'state-1',
        userId: 'user-1',
        sessionToken: 'session-1',
      },
      { clientId: 'client-id' },
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://app.keepr.one/onboarding?googleCalendar=error',
    )
    expect(mocks.captureException).toHaveBeenCalledWith(failure)
  })

  it('returns a successful connection to the same onboarding route', async () => {
    const response = await GET(new Request(
      'https://app.keepr.one/api/agent/integrations/google-calendar/callback?state=state-1&code=code-1',
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://app.keepr.one/onboarding?googleCalendar=connected',
    )
    expect(mocks.enqueueInitialGoogleCalendarSyncs).toHaveBeenCalledWith({
      integrationId: 'integration-1',
      connectedAt: new Date('2026-09-03T12:00:00.000Z'),
      sources: [],
    })
  })
})
