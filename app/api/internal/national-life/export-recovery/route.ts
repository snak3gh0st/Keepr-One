import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import {
  authorizeExportRecoveryRequest,
  recoverInterruptedExportUploads,
} from '@/lib/national-life/local-connector/export-upload-recovery'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Cron entry point for finishing carrier exports whose writing was interrupted. */
export async function POST(request: Request) {
  const authorized = authorizeExportRecoveryRequest(request.headers.get('authorization'))

  if (authorized === 'NOT_CONFIGURED') {
    return Response.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: NO_STORE })
  }
  if (authorized === 'DENIED') {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE })
  }

  try {
    const report = await recoverInterruptedExportUploads(prisma)
    return Response.json(report, { status: 200, headers: NO_STORE })
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ error: 'EXPORT_RECOVERY_FAILED' }, { status: 500, headers: NO_STORE })
  }
}
