import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildGoogleAuthorizationUrl,
  createGooglePkceTransaction,
  exchangeGoogleAuthorizationCode,
  refreshGoogleAccessToken,
  missingGoogleCalendarScopes,
} from './oauth'
import { GoogleReconnectRequiredError } from './errors'
import type { GoogleCalendarEnv } from './env'

const env: GoogleCalendarEnv = {
  clientId: 'client-id', clientSecret: 'client-secret',
  redirectUri: 'https://app.example.com/api/callback',
  webhookUrl: 'https://app.example.com/api/webhook',
  tokenKeyVersion: 'v1', tokenKeys: { v1: Buffer.alloc(32, 7).toString('base64') },
  workerId: 'worker', workerIntervalSeconds: 15, reconcileIntervalSeconds: 300,
  schedulerDisabled: false,
}

afterEach(() => vi.restoreAllMocks())

describe('Google OAuth', () => {
  it('uses state, PKCE S256, offline access and least-privilege scopes', async () => {
    const transaction = createGooglePkceTransaction()
    const url = buildGoogleAuthorizationUrl(transaction, env, { forceConsent: true })
    expect(url.searchParams.get('state')).toBe(transaction.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(transaction.codeChallenge)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('scope')).toContain('calendar.events.freebusy')
    expect(url.searchParams.get('scope')).not.toMatch(/auth\/calendar(?:\s|$)/)
  })

  it('does not force the consent screen for routine reconnect-free authorization', () => {
    const url = buildGoogleAuthorizationUrl(createGooglePkceTransaction(), env)
    expect(url.searchParams.has('prompt')).toBe(false)
  })

  it('rejects granular grants missing event CRUD but keeps FreeBusy optional', () => {
    expect(missingGoogleCalendarScopes(
      'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    )).toEqual(['https://www.googleapis.com/auth/calendar.events'])
    expect(missingGoogleCalendarScopes(
      'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    )).toEqual([])
  })

  it('exchanges the code with its exact verifier', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain('code_verifier=verifier-123')
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' }))
    })
    await expect(exchangeGoogleAuthorizationCode({ code: 'code', codeVerifier: 'verifier-123' }, env, fetchMock as typeof fetch))
      .resolves.toMatchObject({ access_token: 'access', refresh_token: 'refresh' })
  })

  it('turns invalid_grant during refresh into reconnect-required', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    await expect(refreshGoogleAccessToken('dead-refresh', env, fetchMock as typeof fetch))
      .rejects.toBeInstanceOf(GoogleReconnectRequiredError)
  })
})
