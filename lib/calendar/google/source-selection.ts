import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type InitialSource = {
  id: string
  visible: boolean
}

type SourceSelectionDb = Pick<PrismaClient, 'calendarSyncJob' | '$transaction'>

/**
 * A Google account can expose many calendars (including shared/hidden ones).
 * Initial ingestion is deliberately limited to the user's selected sources;
 * the remaining metadata stays available so the user can opt in later.
 */
export async function enqueueInitialGoogleCalendarSyncs(
  input: {
    integrationId: string
    connectedAt: Date
    sources: InitialSource[]
  },
  db: SourceSelectionDb = prisma,
) {
  const selected = input.sources.filter((source) => source.visible)
  if (!selected.length) return { queued: 0 }

  const connectionAttempt = input.connectedAt.toISOString()
  await db.$transaction(
    selected.map((source) => {
      const idempotencyKey =
        `calendar:connect:${input.integrationId}:${connectionAttempt}:${source.id}:full-sync`
      return db.calendarSyncJob.upsert({
        where: { idempotencyKey },
        create: {
          integrationId: input.integrationId,
          calendarId: source.id,
          direction: 'INBOUND',
          operation: 'FULL_SYNC',
          idempotencyKey,
        },
        update: {},
      })
    }),
  )
  return { queued: selected.length }
}
