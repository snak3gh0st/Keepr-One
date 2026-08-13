import * as Sentry from '@sentry/nextjs'
import {
  authorizeFollowUpNotificationRequest,
  runFollowUpNotificationPass,
} from '@/lib/crm/follow-up-notification-scheduler'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Manual trigger for an external cron and operational catch-up. */
export async function POST(request: Request) {
  const authorized = authorizeFollowUpNotificationRequest(
    request.headers.get('authorization'),
  )

  if (authorized === 'NOT_CONFIGURED') {
    return Response.json(
      { error: 'NOT_AVAILABLE' },
      { status: 404, headers: NO_STORE },
    )
  }
  if (authorized === 'DENIED') {
    return Response.json(
      { error: 'UNAUTHORIZED' },
      { status: 401, headers: NO_STORE },
    )
  }

  try {
    const report = await runFollowUpNotificationPass()
    return Response.json(report, { status: 200, headers: NO_STORE })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json(
      { error: 'NOTIFICATION_PASS_FAILED' },
      { status: 500, headers: NO_STORE },
    )
  }
}
