import * as Sentry from '@sentry/nextjs'
import { disconnectGoogleCalendarLocally, readGoogleRefreshToken } from '@/lib/calendar/google/credentials'
import { getGoogleCalendarEnv } from '@/lib/calendar/google/env'
import { revokeGoogleToken } from '@/lib/calendar/google/oauth'
import { requireCalendarUser } from '@/lib/calendar/google/route-auth'
import { stopGoogleCalendarWatch } from '@/lib/calendar/google/watch'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })
  } catch {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }

  try {
    const user = await requireCalendarUser({ allowOnboarding: true })
    const env = getGoogleCalendarEnv()
    const integration = await prisma.calendarIntegration.findUnique({
      where: { userId_provider: { userId: user.userId, provider: 'GOOGLE' } },
      select: { id: true },
    })
    if (!integration) return Response.json({ disconnected: true })
    const refreshToken = await readGoogleRefreshToken(integration.id, env)

    // A channel outlives the browser session and keeps delivering webhook
    // traffic until it expires. Stop every remote channel while credentials
    // still exist; local credential erasure remains the final privacy boundary
    // and is allowed to complete even if Google is temporarily unavailable.
    const channels = await prisma.calendarWatchChannel.findMany({
      where: { integrationId: integration.id, status: { in: ['ACTIVE', 'ERROR'] } },
      select: { id: true },
    })
    for (const channel of channels) {
      try {
        await stopGoogleCalendarWatch(channel.id, env)
      } catch (error) {
        Sentry.captureException(error)
      }
    }

    if (refreshToken) {
      try {
        await revokeGoogleToken(refreshToken)
      } catch (error) {
        // Local removal is the privacy boundary and must complete even if Google
        // is temporarily unavailable. Capture remote revocation for operations.
        Sentry.captureException(error)
      }
    }
    await disconnectGoogleCalendarLocally(user.userId)
    return Response.json({ disconnected: true })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'GOOGLE_CALENDAR_DISCONNECT_FAILED' }, { status: 500 })
  }
}
