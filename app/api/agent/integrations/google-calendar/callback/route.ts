import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { saveGoogleCalendarConnection } from '@/lib/calendar/google/credentials'
import { getGoogleCalendarEnv } from '@/lib/calendar/google/env'
import { exchangeGoogleAuthorizationCode, getGoogleUserInfo, missingGoogleCalendarScopes } from '@/lib/calendar/google/oauth'
import { consumeGoogleOAuthState } from '@/lib/calendar/google/oauth-state'
import { requireCalendarUser, safeCalendarReturnTo } from '@/lib/calendar/google/route-auth'
import { enqueueInitialGoogleCalendarSyncs } from '@/lib/calendar/google/source-selection'
import { syncGoogleCalendarList } from '@/lib/calendar/google/sync'

function callbackRedirect(request: Request, returnTo: string, status: string) {
  const url = new URL(safeCalendarReturnTo(returnTo), request.url)
  url.searchParams.set('googleCalendar', status)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')
  if (!state || (!code && !oauthError)) {
    return NextResponse.json({ error: 'INVALID_OAUTH_CALLBACK' }, { status: 400 })
  }
  try {
    const user = await requireCalendarUser()
    const env = getGoogleCalendarEnv()
    const consumed = await consumeGoogleOAuthState(
      { state, userId: user.userId, sessionToken: user.sessionId },
      env,
    )
    const returnTo = consumed.returnTo ?? '/agent/calendar'
    if (oauthError || !code) return callbackRedirect(request, returnTo, 'denied')

    const tokens = await exchangeGoogleAuthorizationCode(
      { code, codeVerifier: consumed.codeVerifier },
      env,
    )
    if (missingGoogleCalendarScopes(tokens.scope).length) {
      return callbackRedirect(request, returnTo, 'missing-scopes')
    }
    const identity = await getGoogleUserInfo(tokens.access_token)
    if (!identity.email || identity.email_verified === false) {
      return callbackRedirect(request, returnTo, 'unverified-email')
    }
    const integration = await saveGoogleCalendarConnection(
      { userId: user.userId, identity, tokens },
      env,
    )
    const calendars = await syncGoogleCalendarList(integration.id, env)
    await enqueueInitialGoogleCalendarSyncs({
      integrationId: integration.id,
      connectedAt: integration.connectedAt,
      sources: calendars,
    })
    return callbackRedirect(request, returnTo, 'connected')
  } catch (error) {
    Sentry.captureException(error)
    return callbackRedirect(request, '/agent/calendar', 'error')
  }
}
