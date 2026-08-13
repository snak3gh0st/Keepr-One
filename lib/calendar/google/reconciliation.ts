import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  GOOGLE_CALENDAR_RECONCILE_BUCKET_MS,
  GOOGLE_CALENDAR_ROLLING_FULL_SYNC_BUCKET_MS,
} from './constants'
import type { GoogleCalendarEnv } from './env'
import { registerGoogleCalendarWatch, renewExpiringGoogleWatches } from './watch'

type ReconcileDb = Pick<
  PrismaClient,
  'calendarSource' | 'calendarSyncJob' | 'calendarWatchChannel' | '$transaction'
>

function reconcileBucket(now: Date) {
  return Math.floor(now.getTime() / GOOGLE_CALENDAR_RECONCILE_BUCKET_MS)
}

function rollingFullSyncBucket(now: Date) {
  return Math.floor(now.getTime() / GOOGLE_CALENDAR_ROLLING_FULL_SYNC_BUCKET_MS)
}

export async function enqueueGoogleCalendarReconciliation(
  options: { now?: Date; db?: ReconcileDb } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const bucket = reconcileBucket(now)
  const fullBucket = rollingFullSyncBucket(now)
  const sources = await db.calendarSource.findMany({
    where: { visible: true, integration: { status: 'CONNECTED' } },
    select: { id: true, integrationId: true, syncToken: true },
  })
  let queued = 0
  for (const source of sources) {
    await db.calendarSyncJob.upsert({
      where: { idempotencyKey: `calendar:reconcile:${source.id}:bucket:${bucket}` },
      create: {
        integrationId: source.integrationId,
        calendarId: source.id,
        direction: 'RECONCILE',
        operation: source.syncToken ? 'INCREMENTAL_SYNC' : 'FULL_SYNC',
        idempotencyKey: `calendar:reconcile:${source.id}:bucket:${bucket}`,
      },
      update: {},
    })
    queued += 1
    // Incremental tokens inherit the original bounded time window. A daily
    // rolling full pass advances that window so newly materialized recurring
    // instances continue to appear without persisting an unbounded history.
    if (source.syncToken) {
      await db.calendarSyncJob.upsert({
        where: { idempotencyKey: `calendar:rolling-full:${source.id}:bucket:${fullBucket}` },
        create: {
          integrationId: source.integrationId,
          calendarId: source.id,
          direction: 'RECONCILE',
          operation: 'FULL_SYNC',
          idempotencyKey: `calendar:rolling-full:${source.id}:bucket:${fullBucket}`,
        },
        update: {},
      })
      queued += 1
    }
  }
  return { queued }
}

export async function reconcileGoogleCalendarWatches(
  env: GoogleCalendarEnv,
  options: { now?: Date; db?: ReconcileDb } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const renewed = await renewExpiringGoogleWatches(env, { now, db })
  const sources = await db.calendarSource.findMany({
    where: {
      visible: true,
      integration: { status: 'CONNECTED' },
      watchChannels: { none: { status: 'ACTIVE', expiresAt: { gt: now } } },
    },
    select: { id: true },
  })
  let registered = 0
  for (const source of sources) {
    await registerGoogleCalendarWatch(source.id, env, { now, db })
    registered += 1
  }
  return { renewed, registered }
}

export type CalendarInternalAuthResult = 'OK' | 'NOT_CONFIGURED' | 'DENIED'

export function authorizeCalendarInternalRequest(
  authorization: string | null,
  secret: string | undefined,
): CalendarInternalAuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < 32) return 'NOT_CONFIGURED'
  if (!authorization?.startsWith('Bearer ')) return 'DENIED'
  const presented = authorization.slice('Bearer '.length).trim()
  if (!presented) return 'DENIED'
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(digest(configured), digest(presented)) ? 'OK' : 'DENIED'
}
