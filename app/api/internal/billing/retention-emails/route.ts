import * as Sentry from '@sentry/nextjs'
import {
  authorizeRetentionEmailRequest,
  runRetentionEmailPass,
} from '@/lib/billing/retention-email-runner'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Cron entry point for the discount nurture sequence. */
export async function POST(request: Request) {
  const authorized = authorizeRetentionEmailRequest(request.headers.get('authorization'))

  if (authorized === 'NOT_CONFIGURED') {
    return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  }
  if (authorized === 'DENIED') {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const report = await runRetentionEmailPass()
    return Response.json(report, { status: 200, headers: NO_STORE })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'RETENTION_EMAIL_PASS_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
