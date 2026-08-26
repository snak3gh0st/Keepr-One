import { NextResponse } from 'next/server'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from '@/lib/calendar/google/env'
import { buildGoogleAuthorizationUrl } from '@/lib/calendar/google/oauth'
import { createGoogleOAuthState } from '@/lib/calendar/google/oauth-state'
import { requireCalendarUser, safeCalendarReturnTo } from '@/lib/calendar/google/route-auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: 'GOOGLE_CALENDAR_NOT_CONFIGURED' }, { status: 503 })
  }
  try {
    const user = await requireCalendarUser({ allowOnboarding: true })
    const returnTo = safeCalendarReturnTo(new URL(request.url).searchParams.get('returnTo'))
    const env = getGoogleCalendarEnv()
    const transaction = await createGoogleOAuthState(
      { userId: user.userId, sessionToken: user.sessionId, returnTo },
      env,
    )
    const existing = await prisma.calendarIntegration.findUnique({
      where: { userId_provider: { userId: user.userId, provider: 'GOOGLE' } },
      select: { refreshCiphertext: true, status: true },
    })
    return NextResponse.redirect(buildGoogleAuthorizationUrl(transaction, env, {
      forceConsent: !existing?.refreshCiphertext || existing.status === 'RECONNECT_REQUIRED',
    }))
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  }
}
