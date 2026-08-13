import 'server-only'

import { Prisma, type CalendarSyncJob, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  GOOGLE_CALENDAR_JOB_LEASE_MS,
  GOOGLE_CALENDAR_MAX_JOB_ATTEMPTS,
} from './constants'
import { GoogleCalendarClient, type GoogleSendUpdates } from './client'
import { getGoogleAccessToken } from './credentials'
import type { GoogleCalendarEnv } from './env'
import { GoogleApiError, GoogleReconnectRequiredError } from './errors'
import type { GoogleFetch } from './http'
import { googleEventIdForLocalEvent } from './idempotency'
import { mapLocalEventToGoogle } from './mapper'
import { syncGoogleCalendarSource } from './sync'
import { registerGoogleCalendarWatch, stopGoogleCalendarWatch } from './watch'

type OutboxDb = Pick<
  PrismaClient,
  'calendarSyncJob' | 'calendarEvent' | 'calendarSource' | 'calendarWatchChannel' | '$transaction'
>

type ClaimedJob = CalendarSyncJob

function backoff(attempts: number, now: Date) {
  const cappedSeconds = Math.min(3600, 2 ** Math.min(attempts, 10) * 5)
  const deterministicJitter = (attempts * 7919) % 1000
  return new Date(now.getTime() + cappedSeconds * 1000 + deterministicJitter)
}

export async function claimNextGoogleCalendarJob(
  input: { workerId: string; now?: Date; db?: OutboxDb },
): Promise<ClaimedJob | null> {
  const db = input.db ?? prisma
  const now = input.now ?? new Date()
  const leaseExpiresAt = new Date(now.getTime() + GOOGLE_CALENDAR_JOB_LEASE_MS)
  return db.$transaction(async (tx) => {
    // Postgres SKIP LOCKED keeps multiple runtime instances from waiting on one
    // another and preserves queue throughput during a slow Google request.
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "CalendarSyncJob"
      WHERE (
        ("status" = 'PENDING' AND "availableAt" <= ${now})
        OR
        ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${now})
      )
      ORDER BY "availableAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `)
    const candidate = rows[0]
    if (!candidate) return null
    const claimed = await tx.calendarSyncJob.update({
      where: { id: candidate.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: input.workerId,
        leaseExpiresAt,
        attempts: { increment: 1 },
      },
    })
    return claimed
  })
}

function sendUpdates(job: CalendarSyncJob): GoogleSendUpdates {
  return job.sendInvites ? 'all' : 'none'
}

type OutboundJobPayload = {
  recurrenceScope?: 'THIS_EVENT' | 'THIS_AND_FOLLOWING' | 'SERIES'
  previousCalendarId?: string
}

function outboundPayload(job: CalendarSyncJob): OutboundJobPayload {
  if (!job.payload || typeof job.payload !== 'object' || Array.isArray(job.payload)) return {}
  const value = job.payload as Record<string, unknown>
  return {
    recurrenceScope:
      value.recurrenceScope === 'THIS_EVENT' ||
      value.recurrenceScope === 'THIS_AND_FOLLOWING' ||
      value.recurrenceScope === 'SERIES'
        ? value.recurrenceScope
        : undefined,
    previousCalendarId:
      typeof value.previousCalendarId === 'string' ? value.previousCalendarId : undefined,
  }
}

/**
 * A deterministic event id makes create retries recoverable. Google returns
 * 409 when an earlier attempt succeeded but our worker timed out before
 * persisting the provider id; reading that exact id converges both copies.
 */
type CreateGoogleEventInput = {
  calendarId: string
  eventId: string
  payload: ReturnType<typeof mapLocalEventToGoogle>
  sendUpdates: GoogleSendUpdates
  conferenceDataVersion?: 1
}

async function createGoogleEventWithRecoveryStatus(
  client: GoogleCalendarClient,
  input: CreateGoogleEventInput,
) {
  try {
    return {
      event: await client.createEvent(input.calendarId, input.payload, {
        sendUpdates: input.sendUpdates,
        conferenceDataVersion: input.conferenceDataVersion,
      }),
      recoveredExisting: false,
    }
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 409) throw error
    return {
      event: await client.getEvent(input.calendarId, input.eventId),
      recoveredExisting: true,
    }
  }
}

export async function createGoogleEventIdempotently(
  client: GoogleCalendarClient,
  input: CreateGoogleEventInput,
) {
  return (await createGoogleEventWithRecoveryStatus(client, input)).event
}

async function updateGoogleEventWithConflictRecovery(
  client: GoogleCalendarClient,
  input: {
    calendarId: string
    eventId: string
    payload: ReturnType<typeof mapLocalEventToGoogle>
    etag: string | null
    sendUpdates: GoogleSendUpdates
    conferenceDataVersion?: 1
  },
) {
  try {
    return await client.updateEvent(input.calendarId, input.eventId, input.payload, {
      sendUpdates: input.sendUpdates,
      conferenceDataVersion: input.conferenceDataVersion,
      etag: input.etag,
    })
  } catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 412) throw error
    // Resolve an optimistic-write conflict once against the provider's latest
    // ETag. Retrying the stale If-Match value would only dead-letter the job.
    const remote = await client.getEvent(input.calendarId, input.eventId)
    return client.updateEvent(input.calendarId, input.eventId, input.payload, {
      sendUpdates: input.sendUpdates,
      conferenceDataVersion: input.conferenceDataVersion,
      etag: remote.etag ?? null,
    })
  }
}

export async function processOutboundEvent(
  job: CalendarSyncJob,
  env: GoogleCalendarEnv,
  options: { fetch?: GoogleFetch; db: OutboxDb; accessToken?: string },
) {
  const event = job.eventId
    ? await options.db.calendarEvent.findUnique({
        where: { id: job.eventId },
        include: { calendar: true, attendees: true },
      })
    : null
  if (!event || !job.eventId) return

  // A later mutation supersedes this snapshot. The later job carries the final
  // revision, so sending this stale one would briefly resurrect old data.
  if (job.desiredRevision && event.localRevision !== job.desiredRevision) return
  const accessToken = options.accessToken ?? await getGoogleAccessToken(job.integrationId, env, { fetch: options.fetch })
  const client = new GoogleCalendarClient({ accessToken, fetch: options.fetch })
  const calendarId = event.calendar.providerCalendarId
  const expectedProviderId = event.providerEventId ?? googleEventIdForLocalEvent(event.id)
  const intent = outboundPayload(job)
  const providerRelationshipConfirmed = Boolean(
    event.etag || event.lastSyncedAt || event.providerUpdatedAt,
  )

  if (job.operation === 'CREATE_EVENT' && !event.providerEventId) {
    // Persist the deterministic relationship before the network request. A
    // Google push can arrive before Events.insert returns; the inbound worker
    // must still converge on this row instead of creating a duplicate.
    await options.db.calendarEvent.updateMany({
      where: { id: event.id, providerEventId: null },
      data: { providerEventId: expectedProviderId },
    })
  }

  if (intent.recurrenceScope === 'SERIES' && event.providerRecurringEventId) {
    throw new GoogleApiError({
      message: 'Series mutations must target a synchronized recurring master',
      status: 409,
      code: 'RECURRING_MASTER_REQUIRED',
    })
  }
  if (intent.recurrenceScope === 'THIS_AND_FOLLOWING') {
    // Google has no atomic "this and following" mutation. Correct handling
    // requires splitting the RRULE master, which is intentionally rejected
    // here rather than silently mutating only one instance or the whole series.
    throw new GoogleApiError({
      message: 'This-and-following recurrence edits require a series split',
      status: 409,
      code: 'RECURRENCE_SPLIT_REQUIRED',
    })
  }

  if (job.operation === 'DELETE_EVENT') {
    if (!event.providerEventId) return
    try {
      await client.deleteEvent(calendarId, event.providerEventId, { sendUpdates: sendUpdates(job) })
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 404) throw error
    }
    await options.db.calendarEvent.updateMany({
      // Do not let the response from an older delete acknowledge a newer
      // local mutation that was queued while the network request was running.
      where: { id: event.id, localRevision: job.desiredRevision ?? event.localRevision },
      data: { syncStatus: 'SYNCED', syncErrorCode: null, lastSyncedAt: new Date() },
    })
    return
  }

  const payload = mapLocalEventToGoogle(event)
  const { id: _createOnlyEventId, ...updatePayload } = payload
  void _createOnlyEventId
  const usesMeet = Boolean(payload.conferenceData?.createRequest)
  let googleEvent
  if (
    job.operation === 'CREATE_EVENT' ||
    !event.providerEventId ||
    (event.source === 'CRM' && !providerRelationshipConfirmed)
  ) {
    // `providerEventId` is reserved before Events.insert so a push racing the
    // response can converge on this row. It does not, by itself, prove the
    // remote resource exists. If that first create failed and a newer local
    // edit superseded its job, retry the deterministic create in the event's
    // current calendar rather than issuing a PATCH that can only return 404.
    // A provider-side success with a lost response remains safe. When this
    // revision also moved calendars, first recover the resource from the source
    // calendar; creating in the destination before that would leave the first
    // copy orphaned. A source 404 means the original create never succeeded (or
    // a prior retry already moved it), so the deterministic destination create
    // remains the idempotent fallback.
    let providerEtag: string | null = null
    let recoveredByMove = false
    if (
      event.providerEventId &&
      intent.previousCalendarId &&
      intent.previousCalendarId !== event.calendarId
    ) {
      const previous = await options.db.calendarSource.findFirst({
        where: { id: intent.previousCalendarId, integrationId: event.integrationId },
        select: { providerCalendarId: true },
      })
      if (!previous) {
        throw new GoogleApiError({
          message: 'Previous Google calendar source was not found',
          status: 409,
          code: 'PREVIOUS_CALENDAR_NOT_FOUND',
        })
      }
      try {
        const moved = await client.moveEvent(
          previous.providerCalendarId,
          event.providerEventId,
          calendarId,
          { sendUpdates: sendUpdates(job) },
        )
        providerEtag = moved.etag ?? null
        recoveredByMove = true
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 404) throw error
      }
    }

    if (recoveredByMove) {
      googleEvent = await updateGoogleEventWithConflictRecovery(client, {
        calendarId,
        eventId: expectedProviderId,
        payload: updatePayload,
        sendUpdates: sendUpdates(job),
        conferenceDataVersion: usesMeet ? 1 : undefined,
        etag: providerEtag,
      })
    } else {
      const created = await createGoogleEventWithRecoveryStatus(client, {
        calendarId,
        eventId: expectedProviderId,
        payload,
        sendUpdates: sendUpdates(job),
        conferenceDataVersion: usesMeet ? 1 : undefined,
      })
      // A 409 proves only that an earlier attempt created this id. Its payload
      // may be from an older local revision whose response was lost. PATCH the
      // current revision before acknowledging it as synchronized.
      googleEvent = created.recoveredExisting
        ? await updateGoogleEventWithConflictRecovery(client, {
            calendarId,
            eventId: expectedProviderId,
            payload: updatePayload,
            sendUpdates: sendUpdates(job),
            conferenceDataVersion: usesMeet ? 1 : undefined,
            etag: created.event.etag ?? null,
          })
        : created.event
    }
  } else {
    let providerEtag = event.etag
    if (intent.previousCalendarId && intent.previousCalendarId !== event.calendarId) {
      const previous = await options.db.calendarSource.findFirst({
        where: { id: intent.previousCalendarId, integrationId: event.integrationId },
        select: { providerCalendarId: true },
      })
      if (!previous) {
        throw new GoogleApiError({
          message: 'Previous Google calendar source was not found',
          status: 409,
          code: 'PREVIOUS_CALENDAR_NOT_FOUND',
        })
      }
      try {
        const moved = await client.moveEvent(
          previous.providerCalendarId,
          event.providerEventId,
          calendarId,
          { sendUpdates: sendUpdates(job) },
        )
        providerEtag = moved.etag ?? null
      } catch (error) {
        if (!(error instanceof GoogleApiError) || error.status !== 404) throw error
        // Moving and patching are two provider calls. A timeout/failure after a
        // successful move leaves the source returning 404 on retry. Confirm the
        // same event id in the destination and resume with its latest ETag;
        // never create a second resource or dead-letter an already moved one.
        const alreadyMoved = await client.getEvent(calendarId, event.providerEventId)
        providerEtag = alreadyMoved.etag ?? null
      }
    }
    googleEvent = await updateGoogleEventWithConflictRecovery(client, {
      calendarId,
      eventId: event.providerEventId,
      payload: updatePayload,
      sendUpdates: sendUpdates(job),
      conferenceDataVersion: usesMeet ? 1 : undefined,
      etag: providerEtag,
    })
  }
  await options.db.calendarEvent.updateMany({
    // Compare again at persistence time: the user may have edited the event
    // while Google was answering. That later revision must remain PENDING and
    // be delivered by its own job instead of being falsely marked synchronized.
    where: { id: event.id, localRevision: job.desiredRevision ?? event.localRevision },
    data: {
      providerEventId: googleEvent.id,
      etag: googleEvent.etag ?? null,
      iCalUid: googleEvent.iCalUID ?? null,
      sequence: googleEvent.sequence ?? null,
      meetingUrl:
        googleEvent.hangoutLink ??
        googleEvent.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ??
        null,
      conferenceData: googleEvent.conferenceData
        ? (JSON.parse(JSON.stringify(googleEvent.conferenceData)) as Prisma.InputJsonValue)
        : undefined,
      providerUpdatedAt: googleEvent.updated ? new Date(googleEvent.updated) : null,
      syncStatus: 'SYNCED',
      syncErrorCode: null,
      lastSyncedAt: new Date(),
    },
  })
}

async function executeJob(
  job: CalendarSyncJob,
  env: GoogleCalendarEnv,
  options: { fetch?: GoogleFetch; db: OutboxDb },
) {
  if (
    job.direction === 'OUTBOUND' &&
    ['CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT'].includes(job.operation)
  ) {
    return processOutboundEvent(job, env, options)
  }
  if (job.operation === 'FULL_SYNC' || job.operation === 'INCREMENTAL_SYNC') {
    if (!job.calendarId) throw new Error('Inbound sync job is missing calendarId')
    return syncGoogleCalendarSource(job.calendarId, env, {
      fetch: options.fetch,
      forceFull: job.operation === 'FULL_SYNC',
    })
  }
  if (job.operation === 'RENEW_WATCH') {
    if (!job.calendarId) throw new Error('Watch job is missing calendarId')
    return registerGoogleCalendarWatch(job.calendarId, env, { fetch: options.fetch })
  }
  if (job.operation === 'STOP_WATCH') {
    const channelId =
      job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>).channelDbId
        : null
    if (typeof channelId !== 'string') throw new Error('Stop-watch job is missing channelDbId')
    return stopGoogleCalendarWatch(channelId, env, { fetch: options.fetch })
  }
  throw new Error(`Unsupported Google Calendar job ${job.direction}/${job.operation}`)
}

export async function processNextGoogleCalendarJob(
  env: GoogleCalendarEnv,
  options: { now?: Date; fetch?: GoogleFetch; db?: OutboxDb; workerId?: string } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const workerId = options.workerId ?? env.workerId
  const job = await claimNextGoogleCalendarJob({ workerId, now, db })
  if (!job) return null
  try {
    await executeJob(job, env, { fetch: options.fetch, db })
    await db.calendarSyncJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
      data: {
        status: 'SUCCEEDED',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    })
    return { jobId: job.id, status: 'SUCCEEDED' as const }
  } catch (error) {
    const code =
      error instanceof GoogleReconnectRequiredError
        ? error.code
        : error instanceof GoogleApiError
          ? error.code
          : error instanceof Error
            ? error.name
            : 'UNKNOWN_ERROR'
    const retryable =
      error instanceof GoogleApiError
        ? error.retryable || error.status === 412
        : !(error instanceof GoogleReconnectRequiredError)
    const dead = !retryable || job.attempts >= GOOGLE_CALENDAR_MAX_JOB_ATTEMPTS
    await db.calendarSyncJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
      data: {
        status: dead ? 'DEAD_LETTER' : 'PENDING',
        availableAt: dead ? job.availableAt : backoff(job.attempts, now),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: code,
      },
    })
    if (job.eventId) {
      await db.calendarEvent.updateMany({
        // A failure belongs only to the event revision that produced this job.
        // Never stamp ERROR over a newer local edit with a different outbox job.
        where: {
          id: job.eventId,
          ...(job.desiredRevision ? { localRevision: job.desiredRevision } : {}),
        },
        data: { syncStatus: 'ERROR', syncErrorCode: code },
      })
    }
    throw error
  }
}

export async function drainGoogleCalendarOutbox(
  env: GoogleCalendarEnv,
  options: { limit?: number; fetch?: GoogleFetch; db?: OutboxDb; now?: Date } = {},
) {
  const limit = options.limit ?? 25
  let processed = 0
  for (; processed < limit; processed += 1) {
    const result = await processNextGoogleCalendarJob(env, options)
    if (!result) break
  }
  return { processed }
}
