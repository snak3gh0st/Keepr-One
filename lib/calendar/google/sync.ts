import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  GOOGLE_CALENDAR_EVENT_RETENTION_FUTURE_DAYS,
  GOOGLE_CALENDAR_EVENT_RETENTION_PAST_DAYS,
} from './constants'
import { GoogleCalendarClient } from './client'
import { getGoogleAccessToken } from './credentials'
import type { GoogleCalendarEnv } from './env'
import { GoogleSyncTokenExpiredError } from './errors'
import type { GoogleFetch } from './http'
import { mapGoogleEvent, type MappedGoogleEvent } from './mapper'
import type { GoogleCalendarEvent } from './types'
import { attendeeResponseCopy, calendarRescheduleCopy, calendarScheduleChanged } from '../timeline'

type SyncDb = Pick<
  PrismaClient,
  | 'calendarSource'
  | 'calendarEvent'
  | 'calendarEventAttendee'
  | 'calendarIntegration'
  | 'caseTimelineEvent'
  | 'notification'
  | '$transaction'
>

type StoredEvent = {
  id: string
  insuranceCaseId: string | null
  etag: string | null
  title: string
  ownerUserId: string
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  timeZone: string | null
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  localRevision: number
  syncStatus: 'SYNCED' | 'PENDING' | 'PROCESSING' | 'ERROR'
  attendees: Array<{ email: string; responseStatus: string }>
}

type FullSyncSweepCandidate = {
  id: string
  integrationId: string
  insuranceCaseId: string | null
  providerEventId: string | null
  iCalUid: string | null
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  syncStatus: 'SYNCED' | 'PENDING' | 'PROCESSING' | 'ERROR'
}

export type GoogleCalendarSyncReport = {
  calendarId: string
  mode: 'full' | 'incremental'
  upserted: number
  cancelled: number
  nextSyncToken: string | null
  deferred: number
}

function calendarRange(now: Date) {
  return {
    timeMin: new Date(
      now.getTime() - GOOGLE_CALENDAR_EVENT_RETENTION_PAST_DAYS * 24 * 60 * 60_000,
    ).toISOString(),
    timeMax: new Date(
      now.getTime() + GOOGLE_CALENDAR_EVENT_RETENTION_FUTURE_DAYS * 24 * 60 * 60_000,
    ).toISOString(),
  }
}

function timeShapeChanged(current: StoredEvent, next: MappedGoogleEvent) {
  return calendarScheduleChanged(current, next)
}

function attendeeChanges(current: StoredEvent, next: MappedGoogleEvent) {
  const previous = new Map(
    current.attendees.map((attendee) => [attendee.email.toLowerCase(), attendee.responseStatus]),
  )
  return next.attendees.filter(
    (attendee) => previous.get(attendee.email.toLowerCase()) !== attendee.responseStatus,
  )
}

function timelineKey(eventId: string, kind: string, detail: string) {
  return createHash('sha256')
    .update(`google-calendar:${eventId}:${kind}:${detail}`)
    .digest('hex')
}

function timelineHasKey(metadata: Prisma.JsonValue | null, expected: string) {
  return Boolean(
    metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).eventKey === expected,
  )
}

async function createInboundTimelineEntries(
  tx: Prisma.TransactionClient,
  current: StoredEvent,
  next: MappedGoogleEvent,
) {
  if (!current.insuranceCaseId) return
  const requests: Array<{ type: string; title: string; body: string; key: string }> = []
  if (current.status !== 'CANCELLED' && next.status === 'CANCELLED') {
    requests.push({
      type: 'MEETING_CANCELLED_FROM_GOOGLE',
      title: 'Reunião cancelada pelo Google Calendar',
      body: next.title,
      key: timelineKey(current.id, 'cancelled', next.etag ?? next.providerUpdatedAt?.toISOString() ?? 'cancelled'),
    })
  } else if (timeShapeChanged(current, next)) {
    requests.push({
      type: 'MEETING_UPDATED_FROM_GOOGLE',
      title: 'Reunião atualizada pelo Google Calendar',
      body: `${next.title} · ${calendarRescheduleCopy(current, next)}`,
      key: timelineKey(current.id, 'schedule', next.etag ?? next.providerUpdatedAt?.toISOString() ?? 'updated'),
    })
  }
  for (const attendee of attendeeChanges(current, next)) {
    requests.push({
      type: 'MEETING_ATTENDEE_RESPONSE',
      title: 'Participante respondeu ao convite',
      body: attendeeResponseCopy(attendee.email, attendee.responseStatus),
      key: timelineKey(
        current.id,
        'attendee',
        `${attendee.email}:${attendee.responseStatus}:${next.etag ?? next.providerUpdatedAt?.toISOString() ?? ''}`,
      ),
    })
  }
  if (!requests.length) return

  const existing = await tx.caseTimelineEvent.findMany({
    where: {
      caseId: current.insuranceCaseId,
      type: { in: requests.map((request) => request.type) },
    },
    select: { metadata: true },
  })
  for (const request of requests) {
    if (existing.some((entry) => timelineHasKey(entry.metadata, request.key))) continue
    await tx.caseTimelineEvent.create({
      data: {
        caseId: current.insuranceCaseId,
        type: request.type,
        title: request.title,
        body: request.body,
        metadata: {
          eventKey: request.key,
          calendarEventId: current.id,
          provider: 'GOOGLE',
          providerEventId: next.providerEventId,
          etag: next.etag,
        },
      },
    })
    await tx.notification.upsert({
      where: { dedupeKey: `calendar:google:${request.key}` },
      create: {
        recipientUserId: current.ownerUserId,
        calendarEventId: current.id,
        caseId: current.insuranceCaseId,
        type: request.type === 'MEETING_CANCELLED_FROM_GOOGLE'
          ? 'CALENDAR_EVENT_CANCELLED'
          : 'CALENDAR_EVENT_CHANGED',
        title: request.title,
        message: request.body,
        href: `/agent/cases/${current.insuranceCaseId}`,
        dedupeKey: `calendar:google:${request.key}`,
      },
      update: {},
    })
  }
}

function mappedEventData(mapped: MappedGoogleEvent) {
  return {
    providerRecurringEventId: mapped.providerRecurringEventId,
    providerOriginalStartAt: mapped.providerOriginalStartAt,
    providerOriginalStartDate: mapped.providerOriginalStartDate,
    recurrence: mapped.recurrence,
    iCalUid: mapped.iCalUid,
    etag: mapped.etag,
    sequence: mapped.sequence,
    title: mapped.title,
    description: mapped.description,
    startsAt: mapped.startsAt,
    endsAt: mapped.endsAt,
    startDate: mapped.startDate,
    endDate: mapped.endDate,
    timeZone: mapped.timeZone,
    allDay: mapped.allDay,
    location: mapped.location,
    meetingUrl: mapped.meetingUrl,
    conferenceData: mapped.conferenceData ?? Prisma.JsonNull,
    reminders: mapped.reminders ?? Prisma.JsonNull,
    colorId: mapped.colorId,
    visibility: mapped.visibility,
    transparency: mapped.transparency,
    status: mapped.status,
    syncStatus: 'SYNCED' as const,
    syncErrorCode: null,
    providerUpdatedAt: mapped.providerUpdatedAt,
    deletedAt: mapped.deletedAt,
    lastSyncedAt: new Date(),
  }
}

function calendarDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function sameScheduleWhere(event: Pick<
  FullSyncSweepCandidate,
  'allDay' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate'
>): Prisma.CalendarEventWhereInput {
  return event.allDay
    ? {
        allDay: true,
        startDate: event.startDate,
        endDate: event.endDate,
      }
    : {
        allDay: false,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      }
}

/**
 * A full Google events.list pass is a bounded snapshot. Rows inside that exact
 * window which are absent from the completed snapshot no longer belong to the
 * source (they were deleted or moved to another calendar). Keep a tombstone
 * instead of deleting the row so CRM associations and audit history survive.
 *
 * The containment predicates are intentionally narrower than Google's
 * overlap-based timeMin/timeMax filtering. This leaves events touching either
 * edge for a later rolling full sync rather than risking a false deletion due
 * to an all-day calendar time-zone boundary.
 */
export async function sweepMissingGoogleEventsFromFullSync(
  db: SyncDb,
  input: {
    calendarId: string
    timeMin: string
    timeMax: string
    seenProviderEventIds: ReadonlySet<string>
    now: Date
  },
) {
  const timeMin = new Date(input.timeMin)
  const timeMax = new Date(input.timeMax)
  if (
    Number.isNaN(timeMin.getTime()) ||
    Number.isNaN(timeMax.getTime()) ||
    timeMax <= timeMin
  ) {
    throw new Error('Invalid Google full-sync sweep range')
  }
  const minDate = calendarDay(timeMin)
  const maxDate = calendarDay(timeMax)

  return db.$transaction(async (tx) => {
    const candidates = await tx.calendarEvent.findMany({
      where: {
        calendarId: input.calendarId,
        source: 'GOOGLE',
        providerEventId: { not: null },
        // events.list(singleEvents=true) returns expanded instances rather
        // than recurring masters. Never infer deletion of a stored master
        // merely because that representation is absent from this snapshot.
        recurrence: { isEmpty: true },
        status: { not: 'CANCELLED' },
        deletedAt: null,
        OR: [
          {
            allDay: false,
            startsAt: { gte: timeMin },
            endsAt: { lte: timeMax },
          },
          {
            allDay: true,
            // Exclude both boundary dates. Google interprets all-day dates in
            // the calendar's zone while this bounded request uses instants.
            startDate: { gt: minDate },
            endDate: { lte: maxDate },
          },
        ],
      },
      select: {
        id: true,
        integrationId: true,
        insuranceCaseId: true,
        providerEventId: true,
        iCalUid: true,
        allDay: true,
        startsAt: true,
        endsAt: true,
        startDate: true,
        endDate: true,
        syncStatus: true,
      },
    })

    let cancelled = 0
    let preservedLocal = 0
    let associationsTransferred = 0
    for (const candidate of candidates as FullSyncSweepCandidate[]) {
      if (
        !candidate.providerEventId ||
        input.seenProviderEventIds.has(candidate.providerEventId)
      ) continue
      // A pending local create/update is authoritative and may legitimately
      // be absent until the outbox reaches Google.
      if (candidate.syncStatus !== 'SYNCED') {
        preservedLocal += 1
        continue
      }

      // Google keeps an event's provider identity when it is moved. If the
      // destination source was synchronized first, carry the explicit CRM
      // association to that active projection. Requiring provider id,
      // iCalUID and the exact schedule avoids conflating ordinary copies.
      if (candidate.insuranceCaseId && candidate.iCalUid) {
        const destination = await tx.calendarEvent.findFirst({
          where: {
            id: { not: candidate.id },
            integrationId: candidate.integrationId,
            calendarId: { not: input.calendarId },
            source: 'GOOGLE',
            providerEventId: candidate.providerEventId,
            iCalUid: candidate.iCalUid,
            insuranceCaseId: null,
            status: { not: 'CANCELLED' },
            deletedAt: null,
            ...sameScheduleWhere(candidate),
          },
          select: { id: true },
        })
        if (destination) {
          const transferred = await tx.calendarEvent.updateMany({
            where: {
              id: destination.id,
              insuranceCaseId: null,
              status: { not: 'CANCELLED' },
              deletedAt: null,
            },
            data: { insuranceCaseId: candidate.insuranceCaseId },
          })
          associationsTransferred += transferred.count
        }
      }

      const swept = await tx.calendarEvent.updateMany({
        where: {
          id: candidate.id,
          calendarId: input.calendarId,
          source: 'GOOGLE',
          syncStatus: 'SYNCED',
          status: { not: 'CANCELLED' },
          deletedAt: null,
        },
        data: {
          status: 'CANCELLED',
          deletedAt: input.now,
          lastSyncedAt: input.now,
          syncErrorCode: null,
          localRevision: { increment: 1 },
        },
      })
      if (swept.count !== 1) continue
      cancelled += 1
      await tx.notification.updateMany({
        where: { calendarEventId: candidate.id, readAt: null },
        data: { readAt: input.now },
      })
    }

    return { cancelled, preservedLocal, associationsTransferred }
  })
}

export type GoogleCalendarSyncPageTarget = Pick<
  GoogleCalendarClient,
  'listEventPages'
>

/**
 * Keeps the 410 recovery rule independently testable: after Google invalidates
 * a sync token, discard it and perform one complete bounded snapshot before
 * accepting a replacement token.
 */
export async function listGoogleEventPagesWith410Recovery(input: {
  client: GoogleCalendarSyncPageTarget
  calendarId: string
  syncToken: string | null
  timeMin: string
  timeMax: string
  onPage: (events: GoogleCalendarEvent[]) => Promise<void>
  onExpiredToken: () => Promise<void>
}) {
  const list = (syncToken: string | null) => input.client.listEventPages({
    calendarId: input.calendarId,
    syncToken,
    timeMin: input.timeMin,
    timeMax: input.timeMax,
    singleEvents: true,
    onPage: input.onPage,
  })
  try {
    return { nextSyncToken: await list(input.syncToken), reset: false }
  } catch (error) {
    if (!(error instanceof GoogleSyncTokenExpiredError) || !input.syncToken) throw error
    await input.onExpiredToken()
    return { nextSyncToken: await list(null), reset: true }
  }
}

export async function applyGoogleEvent(
  db: SyncDb,
  input: {
    ownerUserId: string
    integrationId: string
    calendarId: string
    event: GoogleCalendarEvent
    now: Date
  },
) {
  const mapped = mapGoogleEvent(input.event, input.now)
  return db.$transaction(async (tx) => {
    const current = await tx.calendarEvent.findUnique({
      where: {
        calendarId_providerEventId: {
          calendarId: input.calendarId,
          providerEventId: mapped.providerEventId,
        },
      },
      select: {
        id: true,
        ownerUserId: true,
        insuranceCaseId: true,
        etag: true,
        title: true,
        allDay: true,
        startsAt: true,
        endsAt: true,
        startDate: true,
        endDate: true,
        timeZone: true,
        status: true,
        localRevision: true,
        syncStatus: true,
        attendees: { select: { email: true, responseStatus: true } },
      },
    })

    // Local-first conflict rule: while a CRM mutation is queued, being sent,
    // or awaiting manual recovery, its local snapshot is authoritative. A
    // Google push can race the deterministic create/update request; applying
    // that provider snapshot here would erase the user's edit and advance the
    // sync token past it. The outbound job converges Google to this snapshot,
    // and its resulting etag is consumed by the following incremental pass.
    if (current && current.syncStatus !== 'SYNCED') {
      return { changed: false, cancelled: false, deferred: true }
    }

    // A webhook may repeat and a reconciliation pass sees the same etag again.
    if (current?.etag && mapped.etag && current.etag === mapped.etag) {
      return { changed: false, cancelled: mapped.status === 'CANCELLED' }
    }
    if (current) await createInboundTimelineEntries(tx, current, mapped)

    let eventId: string
    if (current) {
      // An inbound provider revision is also a new local compare-and-swap
      // version. Without this bump, a form opened before the Google webhook
      // could overwrite the newer provider schedule using a still-valid base
      // revision.
      await tx.calendarEvent.update({
        where: { id: current.id },
        data: { ...mappedEventData(mapped), localRevision: { increment: 1 } },
      })
      eventId = current.id
    } else {
      // Cancelled recurrence exceptions may contain only id, recurringEventId
      // and originalStartTime. Without a valid time shape, there is no active
      // local row to project and nothing user-visible to cancel.
      if (
        (mapped.allDay && (!mapped.startDate || !mapped.endDate)) ||
        (!mapped.allDay && (!mapped.startsAt || !mapped.endsAt))
      ) {
        return { changed: false, cancelled: true }
      }

      // Events.move keeps the provider event id. CalendarSource is part of
      // our unique key, so a destination sync would otherwise create a second
      // active projection until the old source receives its own delta/full
      // pass. An exact provider id + iCalUID + schedule match distinguishes
      // that move from ordinary copied events and preserves a lead link even
      // when the source was swept before the destination was synchronized.
      const previousProjection = mapped.iCalUid
        ? await tx.calendarEvent.findFirst({
            where: {
              integrationId: input.integrationId,
              calendarId: { not: input.calendarId },
              source: 'GOOGLE',
              providerEventId: mapped.providerEventId,
              iCalUid: mapped.iCalUid,
              ...sameScheduleWhere(mapped),
            },
            orderBy: [
              { insuranceCaseId: { sort: 'asc', nulls: 'last' } },
              { updatedAt: 'desc' },
            ],
            select: { id: true, insuranceCaseId: true },
          })
        : null
      const created = await tx.calendarEvent.create({
        data: {
          ownerUserId: input.ownerUserId,
          integrationId: input.integrationId,
          calendarId: input.calendarId,
          insuranceCaseId: previousProjection?.insuranceCaseId ?? null,
          providerEventId: mapped.providerEventId,
          source: 'GOOGLE',
          ...mappedEventData(mapped),
        },
        select: { id: true },
      })
      eventId = created.id
      if (previousProjection) {
        const movedAt = input.now
        const retired = await tx.calendarEvent.updateMany({
          where: {
            id: previousProjection.id,
            source: 'GOOGLE',
            syncStatus: 'SYNCED',
            status: { not: 'CANCELLED' },
            deletedAt: null,
          },
          data: {
            status: 'CANCELLED',
            deletedAt: movedAt,
            lastSyncedAt: movedAt,
            syncErrorCode: null,
            localRevision: { increment: 1 },
          },
        })
        if (retired.count === 1) {
          await tx.notification.updateMany({
            where: { calendarEventId: previousProjection.id, readAt: null },
            data: { readAt: movedAt },
          })
        }
      }
    }
    await tx.calendarEventAttendee.deleteMany({ where: { eventId } })
    if (mapped.attendees.length) {
      await tx.calendarEventAttendee.createMany({
        data: mapped.attendees.map((attendee) => ({ eventId, ...attendee })),
      })
    }
    return { changed: true, cancelled: mapped.status === 'CANCELLED' }
  })
}

export async function syncGoogleCalendarSource(
  calendarSourceId: string,
  env: GoogleCalendarEnv,
  options: { now?: Date; fetch?: GoogleFetch; db?: SyncDb; forceFull?: boolean } = {},
): Promise<GoogleCalendarSyncReport> {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const calendar = await db.calendarSource.findUnique({
    where: { id: calendarSourceId },
    select: {
      id: true,
      integrationId: true,
      providerCalendarId: true,
      syncToken: true,
      integration: { select: { userId: true, status: true } },
    },
  })
  if (!calendar || calendar.integration.status !== 'CONNECTED') {
    throw new Error('Connected Google calendar source not found')
  }
  await db.calendarSource.update({
    where: { id: calendar.id },
    data: { syncStatus: 'PROCESSING', lastErrorCode: null },
  })

  const accessToken = await getGoogleAccessToken(calendar.integrationId, env, {
    now,
    fetch: options.fetch,
    db: db as unknown as CredentialDbForSync,
  })
  const client = new GoogleCalendarClient({ accessToken, fetch: options.fetch })
  let upserted = 0
  let cancelled = 0
  let deferred = 0
  const initialSyncToken = options.forceFull ? null : calendar.syncToken
  let mode: 'full' | 'incremental' = initialSyncToken ? 'incremental' : 'full'
  let seenProviderEventIds = new Set<string>()

  if (options.forceFull && calendar.syncToken) {
    await db.calendarSource.update({
      where: { id: calendar.id },
      data: { syncToken: null },
    })
  }

  try {
    const range = calendarRange(now)
    const listed = await listGoogleEventPagesWith410Recovery({
      client,
      calendarId: calendar.providerCalendarId,
      syncToken: initialSyncToken,
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      // A bounded full sync expands recurring masters into instances so the
      // Agenda's ordinary range query can display them. Incremental sync keeps
      // using the exact same singleEvents=true parameter, as required by the
      // sync-token contract. Only the configured retention window is stored.
      onPage: async (events) => {
        for (const event of events) {
          // Populate the snapshot before applying it. A locally pending row is
          // deliberately deferred, but it is still present remotely and must
          // never be swept as missing.
          seenProviderEventIds.add(event.id)
          const result = await applyGoogleEvent(db, {
            ownerUserId: calendar.integration.userId,
            integrationId: calendar.integrationId,
            calendarId: calendar.id,
            event,
            now,
          })
          if (result.changed) upserted += 1
          if (result.cancelled) cancelled += 1
          if ('deferred' in result && result.deferred) deferred += 1
        }
      },
      onExpiredToken: async () => {
        mode = 'full'
        upserted = 0
        cancelled = 0
        // Pages read before the 410 were incremental deltas, not members of
        // the replacement full snapshot.
        seenProviderEventIds = new Set<string>()
        await db.calendarSource.update({ where: { id: calendar.id }, data: { syncToken: null } })
      },
    })
    if (mode === 'full' && deferred === 0) {
      const swept = await sweepMissingGoogleEventsFromFullSync(db, {
        calendarId: calendar.id,
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        seenProviderEventIds,
        now,
      })
      cancelled += swept.cancelled
    }
    // A deferred page was intentionally not consumed: advancing the token
    // would make that provider revision unreachable after the local outbox
    // finishes. Clear the token so the next pass performs a bounded full sync
    // and converges safely from the resulting Google state.
    const nextSyncToken = deferred > 0 ? null : listed.nextSyncToken
    await db.calendarSource.update({
      where: { id: calendar.id },
      data: {
        syncToken: nextSyncToken,
        syncStatus: deferred > 0 ? 'PENDING' : 'SYNCED',
        lastErrorCode: null,
        ...(mode === 'full'
          ? { lastFullSyncAt: now }
          : { lastIncrementalSyncAt: now }),
      },
    })
    await db.calendarIntegration.update({
      where: { id: calendar.integrationId },
      data: { lastSyncAt: now, lastErrorCode: null },
    })
    return {
      calendarId: calendar.id,
      mode,
      upserted,
      cancelled,
      nextSyncToken,
      deferred,
    }
  } catch (error) {
    await db.calendarSource.update({
      where: { id: calendar.id },
      data: {
        syncStatus: 'ERROR',
        lastErrorCode: error instanceof Error ? error.name : 'UNKNOWN_SYNC_ERROR',
      },
    })
    throw error
  }
}

type CredentialDbForSync = Pick<
  PrismaClient,
  'calendarIntegration' | 'calendarSyncJob' | '$transaction'
>

export async function syncGoogleCalendarList(
  integrationId: string,
  env: GoogleCalendarEnv,
  options: { fetch?: GoogleFetch; db?: SyncDb } = {},
) {
  const db = options.db ?? prisma
  const integration = await db.calendarIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, userId: true, status: true },
  })
  if (!integration || integration.status !== 'CONNECTED') throw new Error('Integration not connected')
  const token = await getGoogleAccessToken(integrationId, env, {
    fetch: options.fetch,
    db: db as unknown as CredentialDbForSync,
  })
  const client = new GoogleCalendarClient({ accessToken: token, fetch: options.fetch })
  const calendars = await client.listCalendars()
  const persisted = []
  for (const entry of calendars) {
    if (entry.deleted) continue
    const source = await db.calendarSource.upsert({
      where: {
        integrationId_providerCalendarId: {
          integrationId,
          providerCalendarId: entry.id,
        },
      },
      create: {
        integrationId,
        providerCalendarId: entry.id,
        name: entry.summaryOverride ?? entry.summary ?? entry.id,
        description: entry.description ?? null,
        colorId: entry.colorId ?? null,
        backgroundColor: entry.backgroundColor ?? null,
        foregroundColor: entry.foregroundColor ?? null,
        isPrimary: Boolean(entry.primary),
        visible: Boolean(entry.selected ?? entry.primary),
        crmDefault: Boolean(entry.primary),
        accessRole: entry.accessRole ?? null,
        timeZone: entry.timeZone ?? null,
      },
      update: {
        name: entry.summaryOverride ?? entry.summary ?? entry.id,
        description: entry.description ?? null,
        colorId: entry.colorId ?? null,
        backgroundColor: entry.backgroundColor ?? null,
        foregroundColor: entry.foregroundColor ?? null,
        isPrimary: Boolean(entry.primary),
        accessRole: entry.accessRole ?? null,
        timeZone: entry.timeZone ?? null,
      },
    })
    persisted.push(source)
  }
  return persisted
}
