import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OIDC_USERINFO_URL,
} from './constants'
import { GOOGLE_CALENDAR_REQUIRED_SCOPES } from '../constants'
import type { GoogleCalendarEnv } from './env'
import { GoogleApiError, GoogleReconnectRequiredError, googleErrorCode } from './errors'
import { googleFetchJson, type GoogleFetch } from './http'
import type { GoogleTokenResponse, GoogleUserInfo } from './types'

export type GooglePkceTransaction = {
  state: string
  codeVerifier: string
  codeChallenge: string
}

function base64Url(value: Buffer) {
  return value.toString('base64url')
}

export function createGooglePkceTransaction(): GooglePkceTransaction {
  const codeVerifier = base64Url(randomBytes(48))
  return {
    state: base64Url(randomBytes(32)),
    codeVerifier,
    codeChallenge: base64Url(createHash('sha256').update(codeVerifier).digest()),
  }
}

export function buildGoogleAuthorizationUrl(
  transaction: GooglePkceTransaction,
  env: GoogleCalendarEnv,
  options: { forceConsent?: boolean } = {},
) {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    state: transaction.state,
    code_challenge: transaction.codeChallenge,
    code_challenge_method: 'S256',
  }).toString()
  if (options.forceConsent) url.searchParams.set('prompt', 'consent')
  return url
}

export function missingGoogleCalendarScopes(granted: string | undefined) {
  const values = new Set(granted?.split(/\s+/).filter(Boolean) ?? [])
  return GOOGLE_CALENDAR_REQUIRED_SCOPES.filter((scope) => !values.has(scope))
}

async function postToken(
  body: URLSearchParams,
  env: GoogleCalendarEnv,
  fetchImpl: GoogleFetch,
) {
  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) {
    const code = googleErrorCode(payload) ?? `HTTP_${response.status}`
    if (code === 'invalid_grant') throw new GoogleReconnectRequiredError()
    throw new GoogleApiError({
      message: `Google OAuth request failed (${code})`,
      status: response.status,
      code,
      responseBody: payload,
    })
  }
  return payload as GoogleTokenResponse
}

export function exchangeGoogleAuthorizationCode(
  input: { code: string; codeVerifier: string },
  env: GoogleCalendarEnv,
  fetchImpl: GoogleFetch = fetch,
) {
  return postToken(
    new URLSearchParams({
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: 'authorization_code',
    }),
    env,
    fetchImpl,
  )
}

export function refreshGoogleAccessToken(
  refreshToken: string,
  env: GoogleCalendarEnv,
  fetchImpl: GoogleFetch = fetch,
) {
  return postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'refresh_token',
    }),
    env,
    fetchImpl,
  )
}

export async function revokeGoogleToken(token: string, fetchImpl: GoogleFetch = fetch) {
  const response = await fetchImpl(GOOGLE_OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  // Google returns 200 for a revoked token and 400 for an already-invalid token.
  // Disconnect remains successful locally either way; network/server errors do not.
  if (response.ok || response.status === 400) return
  const body = await response.text()
  throw new GoogleApiError({
    message: 'Google token revocation failed',
    status: response.status,
    responseBody: body,
  })
}

export function getGoogleUserInfo(accessToken: string, fetchImpl: GoogleFetch = fetch) {
  return googleFetchJson<GoogleUserInfo>(fetchImpl, GOOGLE_OIDC_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
