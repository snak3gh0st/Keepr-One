import * as Sentry from '@sentry/nextjs'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from '@/lib/calendar/google/env'
import { drainGoogleCalendarOutbox } from '@/lib/calendar/google/outbox'
import { authorizeCalendarInternalRequest } from '@/lib/calendar/google/reconciliation'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!isGoogleCalendarConfigured()) return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  const env = getGoogleCalendarEnv()
  const auth = authorizeCalendarInternalRequest(request.headers.get('authorization'), env.cronSecret)
  if (auth === 'NOT_CONFIGURED') return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  if (auth === 'DENIED') return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  try {
    return Response.json(await drainGoogleCalendarOutbox(env, { limit: 100 }), { headers: NO_STORE })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'CALENDAR_SYNC_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
