import * as Sentry from '@sentry/nextjs'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from '@/lib/calendar/google/env'
import {
  authorizeCalendarInternalRequest,
  enqueueGoogleCalendarReconciliation,
  reconcileGoogleCalendarWatches,
} from '@/lib/calendar/google/reconciliation'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!isGoogleCalendarConfigured()) return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  const env = getGoogleCalendarEnv()
  const auth = authorizeCalendarInternalRequest(request.headers.get('authorization'), env.cronSecret)
  if (auth === 'NOT_CONFIGURED') return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  if (auth === 'DENIED') return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  try {
    const [jobs, watches] = await Promise.all([
      enqueueGoogleCalendarReconciliation(),
      reconcileGoogleCalendarWatches(env),
    ])
    return Response.json({ jobs, watches }, { headers: NO_STORE })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'CALENDAR_RECONCILIATION_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
