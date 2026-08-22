import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  GOOGLE_CALENDAR_WATCH_LIFETIME_MS,
  GOOGLE_CALENDAR_WATCH_RENEW_WINDOW_MS,
} from './constants'
import { GoogleCalendarClient } from './client'
import { getGoogleAccessToken } from './credentials'
import { hashGoogleSecret, safeSecretHashEquals } from './crypto'
import type { GoogleCalendarEnv } from './env'
import type { GoogleFetch } from './http'
import { newGoogleWatchIdentity } from './idempotency'

type WatchDb = Pick<
  PrismaClient,
  'calendarSource' | 'calendarWatchChannel' | 'calendarSyncJob' | '$transaction'
>

export type GoogleWebhookHeaders = {
  channelId: string | null
  resourceId: string | null
  resourceState: string | null
  messageNumber: string | null
  channelToken: string | null
  channelExpiration: string | null
}

export function readGoogleWebhookHeaders(headers: Headers): GoogleWebhookHeaders {
  return {
    channelId: headers.get('x-goog-channel-id'),
    resourceId: headers.get('x-goog-resource-id'),
    resourceState: headers.get('x-goog-resource-state'),
    messageNumber: headers.get('x-goog-message-number'),
    channelToken: headers.get('x-goog-channel-token'),
    channelExpiration: headers.get('x-goog-channel-expiration'),
  }
}

function parseMessageNumber(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

export async function acceptGoogleWebhook(
  headers: GoogleWebhookHeaders,
  options: { now?: Date; db?: WatchDb } = {},
) {
  if (!headers.channelId || !headers.resourceId || !headers.channelToken) return null
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const messageNumber = parseMessageNumber(headers.messageNumber)
  if (messageNumber === null) return null
  return db.$transaction(async (tx) => {
    const channel = await tx.calendarWatchChannel.findUnique({
      where: { providerChannelId: headers.channelId! },
    })
    if (
      !channel ||
      channel.status !== 'ACTIVE' ||
      channel.expiresAt <= now ||
      channel.resourceId !== headers.resourceId ||
      !safeSecretHashEquals(headers.channelToken!, channel.channelTokenHash)
    ) {
      return null
    }
    // Message numbers are monotonically increasing per channel. Ignore replays.
    if (channel.lastMessageNumber !== null && messageNumber <= channel.lastMessageNumber) {
      return { accepted: true, duplicate: true, calendarId: channel.calendarId }
    }
    await tx.calendarWatchChannel.update({
      where: { id: channel.id },
      data: { lastMessageNumber: messageNumber, lastReceivedAt: now },
    })
    await tx.calendarSyncJob.upsert({
      where: { idempotencyKey: `calendar:webhook:${channel.id}:message:${messageNumber}` },
      create: {
        integrationId: channel.integrationId,
        calendarId: channel.calendarId,
        direction: 'INBOUND',
        operation: 'INCREMENTAL_SYNC',
        idempotencyKey: `calendar:webhook:${channel.id}:message:${messageNumber}`,
      },
      update: {},
    })
    return { accepted: true, duplicate: false, calendarId: channel.calendarId }
  })
}

export async function registerGoogleCalendarWatch(
  calendarSourceId: string,
  env: GoogleCalendarEnv,
  options: { now?: Date; fetch?: GoogleFetch; db?: WatchDb } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const calendar = await db.calendarSource.findUnique({
    where: { id: calendarSourceId },
    select: { id: true, integrationId: true, providerCalendarId: true },
  })
  if (!calendar) throw new Error('Calendar source not found')
  const accessToken = await getGoogleAccessToken(calendar.integrationId, env, {
    now,
    fetch: options.fetch,
  })
  const identity = newGoogleWatchIdentity()
  const expiresAt = new Date(now.getTime() + GOOGLE_CALENDAR_WATCH_LIFETIME_MS)
  const client = new GoogleCalendarClient({ accessToken, fetch: options.fetch })
  const watched = await client.watchEvents({
    calendarId: calendar.providerCalendarId,
    address: env.webhookUrl,
    channelId: identity.channelId,
    token: identity.token,
    expiresAt,
  })
  const providerExpiry = watched.expiration ? new Date(Number(watched.expiration)) : expiresAt
  if (Number.isNaN(providerExpiry.getTime())) throw new Error('Google returned an invalid watch expiration')
  const channel = await db.calendarWatchChannel.create({
    data: {
      integrationId: calendar.integrationId,
      calendarId: calendar.id,
      providerChannelId: watched.id,
      resourceId: watched.resourceId,
      resourceUri: watched.resourceUri ?? null,
      channelTokenHash: hashGoogleSecret(identity.token),
      expiresAt: providerExpiry,
      status: 'ACTIVE',
    },
  })
  await db.calendarSyncJob.upsert({
    where: { idempotencyKey: `calendar:watch:${channel.id}:initial-sync` },
    create: {
      integrationId: calendar.integrationId,
      calendarId: calendar.id,
      direction: 'INBOUND',
      operation: 'INCREMENTAL_SYNC',
      idempotencyKey: `calendar:watch:${channel.id}:initial-sync`,
    },
    update: {},
  })
  return { channel, secretToken: identity.token }
}

export async function stopGoogleCalendarWatch(
  channelDbId: string,
  env: GoogleCalendarEnv,
  options: { fetch?: GoogleFetch; db?: WatchDb } = {},
) {
  const db = options.db ?? prisma
  const channel = await db.calendarWatchChannel.findUnique({ where: { id: channelDbId } })
  if (!channel || channel.status === 'STOPPED') return
  try {
    const accessToken = await getGoogleAccessToken(channel.integrationId, env, { fetch: options.fetch })
    await new GoogleCalendarClient({ accessToken, fetch: options.fetch }).stopChannel(
      channel.providerChannelId,
      channel.resourceId,
    )
  } finally {
    await db.calendarWatchChannel.update({
      where: { id: channel.id },
      data: { status: 'STOPPED' },
    })
  }
}

export async function renewExpiringGoogleWatches(
  env: GoogleCalendarEnv,
  options: { now?: Date; fetch?: GoogleFetch; db?: WatchDb } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const renewBefore = new Date(now.getTime() + GOOGLE_CALENDAR_WATCH_RENEW_WINDOW_MS)
  const expiring = await db.calendarWatchChannel.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: renewBefore } },
    select: { id: true, calendarId: true },
  })
  let renewed = 0
  for (const previous of expiring) {
    // New channel first, then old channel stop: overlapping validity avoids a gap.
    await registerGoogleCalendarWatch(previous.calendarId, env, { now, fetch: options.fetch, db })
    await stopGoogleCalendarWatch(previous.id, env, { fetch: options.fetch, db })
    renewed += 1
  }
  return renewed
}
