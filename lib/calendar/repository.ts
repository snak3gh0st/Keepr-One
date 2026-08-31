import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  CalendarDomainError,
  normalizeAttendees,
  normalizeEventTitle,
  ownedCalendarEventWhere,
  ownedCaseWhere,
  requirePositiveRevision,
  requireWritableCalendar,
  scheduleData,
  validateCalendarRangeInput,
} from './access'
import { CALENDAR_NOTIFICATION_TYPES, CALENDAR_TIMELINE_TYPES } from './constants'
import {
  addCalendarDays,
  assertValidIanaTimeZone,
  dateKeyInTimeZone,
  dateRangeForInstants,
  dayBoundsInTimeZone,
  parseCalendarDate,
  zonedDateTimeToUtc,
} from './time'
import { calendarRescheduleCopy, calendarScheduleChanged, formatCalendarScheduleForTimeline } from './timeline'
import type {
  AssociateCalendarEventWithCaseInput,
  CalendarConnectionView,
  CalendarEventView,
  CalendarJson,
  CalendarNotificationRelation,
  CalendarRangeInput,
  CancelCalendarEventInput,
  CreateCalendarEventInput,
  SetCalendarPreferencesInput,
  TodayCalendarSummary,
  UpdateCalendarEventInput,
} from './types'

type CalendarReadDb = Pick<PrismaClient, 'calendarIntegration' | 'calendarEvent' | 'insuranceCase' | 'user'>
type CalendarWriteDb = Pick<PrismaClient, '$transaction'>
export type CalendarTransaction = Prisma.TransactionClient
type Transaction = CalendarTransaction

const calendarConnectionSelect = {
  id: true,
  provider: true,
  providerEmail: true,
  displayName: true,
  status: true,
  grantedScopes: true,
  tokenExpiresAt: true,
  connectedAt: true,
  lastSyncAt: true,
  lastErrorCode: true,
  calendars: {
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      providerCalendarId: true,
      name: true,
      description: true,
      backgroundColor: true,
      foregroundColor: true,
      isPrimary: true,
      visible: true,
      crmDefault: true,
      accessRole: true,
      timeZone: true,
      syncStatus: true,
      lastIncrementalSyncAt: true,
      lastFullSyncAt: true,
    },
  },
} satisfies Prisma.CalendarIntegrationSelect

const calendarEventSelect = {
  id: true,
  ownerUserId: true,
  integrationId: true,
  insuranceCaseId: true,
  providerEventId: true,
  providerRecurringEventId: true,
  title: true,
  description: true,
  allDay: true,
  startsAt: true,
  endsAt: true,
  startDate: true,
  endDate: true,
  timeZone: true,
  location: true,
  meetingUrl: true,
  conferenceData: true,
  reminders: true,
  recurrence: true,
  status: true,
  source: true,
  syncStatus: true,
  syncErrorCode: true,
  localRevision: true,
  createdAt: true,
  updatedAt: true,
  calendar: {
    select: {
      id: true,
      providerCalendarId: true,
      name: true,
      backgroundColor: true,
      foregroundColor: true,
    },
  },
  attendees: {
    orderBy: [{ isOrganizer: 'desc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      name: true,
      responseStatus: true,
      isSelf: true,
      isOrganizer: true,
    },
  },
} satisfies Prisma.CalendarEventSelect

type CalendarEventRecord = Prisma.CalendarEventGetPayload<{ select: typeof calendarEventSelect }>
type CalendarConnectionRecord = Prisma.CalendarIntegrationGetPayload<{ select: typeof calendarConnectionSelect }>

function iso(value: Date | null) {
  return value?.toISOString() ?? null
}

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null
}

function json(value: Prisma.JsonValue | null): CalendarJson {
  return value as CalendarJson
}

export function toCalendarConnectionView(value: CalendarConnectionRecord): CalendarConnectionView {
  return {
    id: value.id,
    provider: value.provider,
    providerEmail: value.providerEmail,
    displayName: value.displayName,
    status: value.status,
    grantedScopes: [...value.grantedScopes],
    tokenExpiresAt: iso(value.tokenExpiresAt),
    connectedAt: value.connectedAt.toISOString(),
    lastSyncAt: iso(value.lastSyncAt),
    lastErrorCode: value.lastErrorCode,
    calendars: value.calendars.map((calendar) => ({
      id: calendar.id,
      providerCalendarId: calendar.providerCalendarId,
      name: calendar.name,
      description: calendar.description,
      backgroundColor: calendar.backgroundColor,
      foregroundColor: calendar.foregroundColor,
      isPrimary: calendar.isPrimary,
      visible: calendar.visible,
      crmDefault: calendar.crmDefault,
      accessRole: calendar.accessRole,
      timeZone: calendar.timeZone,
      syncStatus: calendar.syncStatus,
      lastSyncedAt: iso(calendar.lastIncrementalSyncAt ?? calendar.lastFullSyncAt),
    })),
  }
}

export function toCalendarEventView(value: CalendarEventRecord): CalendarEventView {
  return {
    id: value.id,
    ownerUserId: value.ownerUserId,
    integrationId: value.integrationId,
    calendar: value.calendar,
    caseId: value.insuranceCaseId,
    providerEventId: value.providerEventId,
    providerRecurringEventId: value.providerRecurringEventId,
    title: value.title,
    description: value.description,
    allDay: value.allDay,
    startsAt: iso(value.startsAt),
    endsAt: iso(value.endsAt),
    startDate: dateOnly(value.startDate),
    endDate: dateOnly(value.endDate),
    timeZone: value.timeZone,
    location: value.location,
    meetingUrl: value.meetingUrl,
    conferenceData: json(value.conferenceData),
    reminders: json(value.reminders),
    recurrence: [...value.recurrence],
    status: value.status,
    source: value.source,
    syncStatus: value.syncStatus,
    syncErrorCode: value.syncErrorCode,
    localRevision: value.localRevision,
    attendees: value.attendees,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  }
}

export async function getCalendarConnectionForUser(userId: string, db: CalendarReadDb = prisma) {
  if (!userId.trim()) throw new CalendarDomainError('VALIDATION_ERROR', 'userId is required')
  const connection = await db.calendarIntegration.findUnique({
    where: { userId_provider: { userId, provider: 'GOOGLE' } },
    select: calendarConnectionSelect,
  })
  return connection ? toCalendarConnectionView(connection) : null
}

export async function getCalendarEventsForRange(input: CalendarRangeInput, db: CalendarReadDb = prisma) {
  validateCalendarRangeInput(input)
  if (input.caseId) await assertOwnedCase(db, input.ownerUserId, input.caseId)
  const user = await db.user.findUnique({ where: { id: input.ownerUserId }, select: { timeZone: true } })
  if (!user) return []
  assertValidIanaTimeZone(user.timeZone)
  const dates = dateRangeForInstants(input.start, input.end, user.timeZone)
  const events = await db.calendarEvent.findMany({
    where: {
      ownerUserId: input.ownerUserId,
      integration: { userId: input.ownerUserId },
      calendar: { integration: { userId: input.ownerUserId }, visible: true },
      insuranceCaseId: input.caseId,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      OR: [
        { allDay: false, startsAt: { lt: input.end }, endsAt: { gt: input.start } },
        { allDay: true, startDate: { lt: dates.endDate }, endDate: { gt: dates.startDate } },
      ],
    },
    select: calendarEventSelect,
  })
  return events.map(toCalendarEventView).sort(compareCalendarEvents)
}

/**
 * Resolves one calendar event for a deep link without depending on the
 * currently rendered calendar range. Ownership is repeated across the event,
 * integration and source so a guessed id can never expose another user's
 * appointment.
 */
export async function getCalendarEventForUser(
  input: { ownerUserId: string; eventId: string },
  db: CalendarReadDb = prisma,
) {
  if (!input.eventId.trim()) {
    throw new CalendarDomainError('VALIDATION_ERROR', 'eventId is required')
  }
  const event = await db.calendarEvent.findFirst({
    where: {
      ...ownedCalendarEventBase(input.ownerUserId),
      id: input.eventId,
      deletedAt: null,
    },
    select: calendarEventSelect,
  })
  return event ? toCalendarEventView(event) : null
}

export async function getCalendarEventsForCase(
  input: { ownerUserId: string; caseId: string },
  db: CalendarReadDb = prisma,
) {
  await assertOwnedCase(db, input.ownerUserId, input.caseId)
  const events = await db.calendarEvent.findMany({
    where: {
      ...ownedCalendarEventBase(input.ownerUserId),
      insuranceCaseId: input.caseId,
    },
    select: calendarEventSelect,
  })
  return events.map(toCalendarEventView).sort(compareCalendarEvents)
}

export async function getTodayCalendarSummary(
  input: { ownerUserId: string; now?: Date; timeZone: string },
  db: CalendarReadDb = prisma,
): Promise<TodayCalendarSummary> {
  assertValidIanaTimeZone(input.timeZone)
  const now = input.now ?? new Date()
  const { start, end } = dayBoundsInTimeZone(now, input.timeZone)
  const events = await getCalendarEventsForRange({ ownerUserId: input.ownerUserId, start, end }, db)
  return {
    timeZone: input.timeZone,
    start: start.toISOString(),
    end: end.toISOString(),
    total: events.length,
    crmMeetings: events.filter((event) => event.caseId !== null).length,
    externalEvents: events.filter((event) => event.caseId === null).length,
    upcoming: events.filter((event) => event.allDay || !event.endsAt || new Date(event.endsAt) > now),
    events,
  }
}

const UPCOMING_CALENDAR_LOOKAHEAD_DAYS = 14
const UPCOMING_CALENDAR_EVENT_LIMIT = 6

/**
 * Returns the user's next commitments after the current local day. Timed and
 * all-day events are read separately so each branch can use its existing
 * `(ownerUserId, startsAt)` / `(ownerUserId, startDate)` index before the
 * small bounded result sets are merged chronologically.
 */
export async function getUpcomingCalendarEvents(
  input: {
    ownerUserId: string
    now?: Date
    timeZone: string
    lookaheadDays?: number
    limit?: number
  },
  db: CalendarReadDb = prisma,
) {
  assertValidIanaTimeZone(input.timeZone)
  const now = input.now ?? new Date()
  const start = dayBoundsInTimeZone(now, input.timeZone).end
  const startDateKey = dateKeyInTimeZone(start, input.timeZone)
  const lookaheadDays = Math.min(Math.max(input.lookaheadDays ?? UPCOMING_CALENDAR_LOOKAHEAD_DAYS, 1), 31)
  const limit = Math.min(Math.max(input.limit ?? UPCOMING_CALENDAR_EVENT_LIMIT, 1), 12)
  const endDateKey = addCalendarDays(startDateKey, lookaheadDays)
  const [year, month, day] = endDateKey.split('-').map(Number)
  const end = zonedDateTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, input.timeZone)
  const startDate = parseCalendarDate(startDateKey)
  const endDate = parseCalendarDate(endDateKey)
  const ownership = {
    ownerUserId: input.ownerUserId,
    integration: { userId: input.ownerUserId },
    calendar: { integration: { userId: input.ownerUserId }, visible: true },
    deletedAt: null,
    status: { not: 'CANCELLED' as const },
  }

  const [timed, allDay] = await Promise.all([
    db.calendarEvent.findMany({
      where: {
        ...ownership,
        allDay: false,
        startsAt: { gte: start, lt: end },
      },
      orderBy: [{ startsAt: 'asc' }, { title: 'asc' }],
      take: limit,
      select: calendarEventSelect,
    }),
    db.calendarEvent.findMany({
      where: {
        ...ownership,
        allDay: true,
        startDate: { gte: startDate, lt: endDate },
      },
      orderBy: [{ startDate: 'asc' }, { title: 'asc' }],
      take: limit,
      select: calendarEventSelect,
    }),
  ])

  return [...timed, ...allDay]
    .map(toCalendarEventView)
    .sort(compareCalendarEvents)
    .slice(0, limit)
}

export async function createCalendarEvent(input: CreateCalendarEventInput, db: CalendarWriteDb = prisma) {
  return db.$transaction((tx) => createCalendarEventInTransaction(input, tx))
}

/**
 * Shared transaction-scoped lock for all local writes that can claim time in
 * one user's agenda. Public bookings acquire it before their final conflict
 * recheck, then call the transaction-safe event creator below.
 */
export async function lockCalendarSchedulingOwner(
  tx: CalendarTransaction,
  ownerUserId: string,
) {
  if (!ownerUserId.trim()) throw new CalendarDomainError('VALIDATION_ERROR', 'ownerUserId is required')
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`keepr-calendar-scheduling:${ownerUserId}`}, 0)
    )
  `)
}

/** Creates the local event, attendees and Google outbox job atomically. */
export async function createCalendarEventInTransaction(
  input: CreateCalendarEventInput,
  tx: CalendarTransaction,
) {
  const title = normalizeEventTitle(input.title)
  const attendees = normalizeAttendees(input.attendees)
  const schedule = scheduleData(input.schedule)
  await lockCalendarSchedulingOwner(tx, input.ownerUserId)
  const calendar = await writableCalendar(tx, input.ownerUserId, input.calendarId)
  if (input.caseId) await assertOwnedCase(tx, input.ownerUserId, input.caseId)
  const event = await tx.calendarEvent.create({
    data: {
      ownerUserId: input.ownerUserId,
      integrationId: calendar.integrationId,
      calendarId: calendar.id,
      insuranceCaseId: input.caseId ?? null,
      title,
      description: optionalText(input.description),
      ...schedule,
      location: optionalText(input.location),
      conferenceData: input.createGoogleMeet ? { createMeetRequested: true } : Prisma.JsonNull,
      recurrence: input.recurrence ?? [],
      reminders: input.reminders === undefined || input.reminders === null ? Prisma.JsonNull : input.reminders,
      source: 'CRM',
      syncStatus: 'PENDING',
      attendees: { create: attendees.map((attendee) => ({ email: attendee.email, name: attendee.name })) },
    },
    select: calendarEventSelect,
  })
  await enqueueEventSync(tx, event, 'CREATE_EVENT', input.sendInvites)
  if (event.insuranceCaseId) await createTimelineEntry(tx, event, CALENDAR_TIMELINE_TYPES.created)
  return toCalendarEventView(event)
}

export async function updateCalendarEvent(input: UpdateCalendarEventInput, db: CalendarWriteDb = prisma) {
  requirePositiveRevision(input.baseRevision)
  const title = input.title === undefined ? undefined : normalizeEventTitle(input.title)
  const attendees = input.attendees === undefined ? undefined : normalizeAttendees(input.attendees)
  const schedule = input.schedule === undefined ? undefined : scheduleData(input.schedule)
  return db.$transaction(async (tx) => {
    await lockCalendarSchedulingOwner(tx, input.ownerUserId)
    const current = await tx.calendarEvent.findFirst({
      where: ownedCalendarEventWhere(input.ownerUserId, input.eventId),
      select: {
        id: true, calendarId: true, providerEventId: true, localRevision: true,
        status: true, insuranceCaseId: true, allDay: true, startsAt: true,
        endsAt: true, startDate: true, endDate: true, timeZone: true,
        schedulingBooking: {
          select: {
            id: true,
            status: true,
            blockedStartsAt: true,
            blockedEndsAt: true,
          },
        },
      },
    })
    if (!current) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
    if (current.status === 'CANCELLED') throw new CalendarDomainError('EVENT_NOT_FOUND', 'Esse compromisso já foi cancelado.')
    if (current.localRevision !== input.baseRevision) throw revisionConflict()
    if (current.schedulingBooking?.status === 'CONFIRMED' && schedule?.allDay) {
      throw new CalendarDomainError(
        'VALIDATION_ERROR',
        'Uma reserva pública não pode ser convertida em compromisso de dia inteiro.',
      )
    }
    const calendar = await writableCalendar(tx, input.ownerUserId, input.calendarId ?? current.calendarId)
    if (input.caseId) await assertOwnedCase(tx, input.ownerUserId, input.caseId)
    const nextRevision = input.baseRevision + 1
    const updated = await tx.calendarEvent.updateMany({
      where: { ...ownedCalendarEventWhere(input.ownerUserId, input.eventId), localRevision: input.baseRevision, status: { not: 'CANCELLED' } },
      data: {
        calendarId: calendar.id,
        integrationId: calendar.integrationId,
        insuranceCaseId: input.caseId === undefined ? undefined : input.caseId,
        title,
        description: input.description === undefined ? undefined : optionalText(input.description),
        ...schedule,
        location: input.location === undefined ? undefined : optionalText(input.location),
        // `false` means "do not add Meet"; it must not silently remove an
        // existing conference when an edit form submits its default value.
        conferenceData: input.createGoogleMeet ? { createMeetRequested: true } : undefined,
        recurrence: input.recurrence,
        reminders: input.reminders === undefined ? undefined : input.reminders === null ? Prisma.JsonNull : input.reminders,
        syncStatus: 'PENDING',
        syncErrorCode: null,
        localRevision: nextRevision,
      },
    })
    if (updated.count !== 1) throw revisionConflict()
    if (attendees) {
      await tx.calendarEventAttendee.deleteMany({ where: { eventId: input.eventId } })
      if (attendees.length) await tx.calendarEventAttendee.createMany({
        data: attendees.map((attendee) => ({ eventId: input.eventId, email: attendee.email, name: attendee.name })),
      })
    }
    const event = await tx.calendarEvent.findFirstOrThrow({
      where: ownedCalendarEventWhere(input.ownerUserId, input.eventId),
      select: calendarEventSelect,
    })
    if (
      current.schedulingBooking?.status === 'CONFIRMED' &&
      current.startsAt && current.endsAt && event.startsAt && event.endsAt
    ) {
      const bufferBeforeMs = current.startsAt.getTime() -
        current.schedulingBooking.blockedStartsAt.getTime()
      const bufferAfterMs = current.schedulingBooking.blockedEndsAt.getTime() -
        current.endsAt.getTime()
      await tx.schedulingBooking.update({
        where: { id: current.schedulingBooking.id },
        data: {
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          blockedStartsAt: new Date(event.startsAt.getTime() - bufferBeforeMs),
          blockedEndsAt: new Date(event.endsAt.getTime() + bufferAfterMs),
        },
      })
    }
    await enqueueEventSync(
      tx,
      event,
      current.providerEventId ? 'UPDATE_EVENT' : 'CREATE_EVENT',
      input.sendInvites,
      { recurrenceScope: input.recurrenceScope ?? 'THIS_EVENT', previousCalendarId: current.calendarId },
    )
    if (event.insuranceCaseId) {
      await createTimelineEntry(tx, event, CALENDAR_TIMELINE_TYPES.updated, {
        previousSchedule: calendarScheduleChanged(current, event) ? current : undefined,
      })
    }
    return toCalendarEventView(event)
  })
}

export async function cancelCalendarEvent(input: CancelCalendarEventInput, db: CalendarWriteDb = prisma) {
  requirePositiveRevision(input.baseRevision)
  return db.$transaction(async (tx) => {
    const current = await tx.calendarEvent.findFirst({
      where: ownedCalendarEventWhere(input.ownerUserId, input.eventId),
      select: { id: true, localRevision: true, status: true },
    })
    if (!current) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
    if (current.status === 'CANCELLED') {
      const cancelled = await tx.calendarEvent.findFirstOrThrow({ where: ownedCalendarEventWhere(input.ownerUserId, input.eventId), select: calendarEventSelect })
      await tx.schedulingBooking.updateMany({
        where: { calendarEventId: cancelled.id, ownerUserId: input.ownerUserId, status: 'CONFIRMED' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
      return toCalendarEventView(cancelled)
    }
    if (current.localRevision !== input.baseRevision) throw revisionConflict()
    const cancelledAt = new Date()
    const updated = await tx.calendarEvent.updateMany({
      where: { ...ownedCalendarEventWhere(input.ownerUserId, input.eventId), localRevision: input.baseRevision, status: { not: 'CANCELLED' } },
      data: {
        status: 'CANCELLED', deletedAt: cancelledAt, syncStatus: 'PENDING', syncErrorCode: null,
        localRevision: input.baseRevision + 1,
      },
    })
    if (updated.count !== 1) throw revisionConflict()
    const event = await tx.calendarEvent.findFirstOrThrow({ where: ownedCalendarEventWhere(input.ownerUserId, input.eventId), select: calendarEventSelect })
    await enqueueEventSync(
      tx,
      event,
      'DELETE_EVENT',
      input.sendInvites,
      { recurrenceScope: input.recurrenceScope ?? 'THIS_EVENT' },
    )
    await tx.notification.updateMany({ where: { calendarEventId: event.id, recipientUserId: input.ownerUserId, readAt: null }, data: { readAt: cancelledAt } })
    await tx.schedulingBooking.updateMany({
      where: { calendarEventId: event.id, ownerUserId: input.ownerUserId, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledAt },
    })
    if (event.insuranceCaseId) await createTimelineEntry(tx, event, CALENDAR_TIMELINE_TYPES.cancelled)
    return toCalendarEventView(event)
  })
}

export async function associateCalendarEventWithCase(
  input: AssociateCalendarEventWithCaseInput,
  db: CalendarWriteDb = prisma,
) {
  return db.$transaction(async (tx) => {
    await assertOwnedCase(tx, input.ownerUserId, input.caseId)
    const current = await tx.calendarEvent.findFirst({
      where: ownedCalendarEventWhere(input.ownerUserId, input.eventId),
      select: { id: true, insuranceCaseId: true, localRevision: true },
    })
    if (!current) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
    if (current.insuranceCaseId !== input.caseId) {
      const updated = await tx.calendarEvent.updateMany({
        where: { ...ownedCalendarEventWhere(input.ownerUserId, input.eventId), localRevision: current.localRevision },
        // A CRM association is local metadata, not a provider mutation. Keep
        // the synchronization revision untouched so an already-enqueued
        // create/update keeps matching its desiredRevision and cannot be
        // discarded by the outbox as stale.
        data: { insuranceCaseId: input.caseId },
      })
      if (updated.count !== 1) throw revisionConflict()
    }
    const event = await tx.calendarEvent.findFirstOrThrow({
      where: { ...ownedCalendarEventWhere(input.ownerUserId, input.eventId), insuranceCaseId: input.caseId },
      select: calendarEventSelect,
    })
    if (current.insuranceCaseId !== input.caseId) await createTimelineEntry(tx, event, CALENDAR_TIMELINE_TYPES.associated)
    return toCalendarEventView(event)
  })
}

export async function setCalendarPreferences(input: SetCalendarPreferencesInput, db: CalendarWriteDb = prisma) {
  const visibleCalendarIds = [...new Set(input.visibleCalendarIds)]
  if (!visibleCalendarIds.includes(input.crmDefaultCalendarId)) {
    throw new CalendarDomainError('VALIDATION_ERROR', 'O calendário padrão também precisa estar visível.')
  }
  return db.$transaction(async (tx) => {
    const integration = await tx.calendarIntegration.findUnique({
      where: { userId_provider: { userId: input.ownerUserId, provider: 'GOOGLE' } },
      select: { id: true, status: true },
    })
    if (!integration) throw new CalendarDomainError('CONNECTION_NOT_FOUND', 'Google Calendar não conectado.')
    const allCalendars = await tx.calendarSource.findMany({
      where: { integrationId: integration.id },
      select: {
        id: true,
        visible: true,
        syncToken: true,
        updatedAt: true,
        accessRole: true,
        integration: { select: { userId: true, status: true } },
      },
    })
    const visibleSet = new Set(visibleCalendarIds)
    const calendars = allCalendars.filter((calendar) => visibleSet.has(calendar.id))
    if (calendars.length !== visibleCalendarIds.length) throw new CalendarDomainError('CALENDAR_NOT_FOUND', 'Um ou mais calendários não pertencem a esta conta.')
    const crmDefault = calendars.find((calendar) => calendar.id === input.crmDefaultCalendarId)
    if (!crmDefault) throw new CalendarDomainError('CALENDAR_NOT_FOUND', 'Calendário padrão não encontrado.')
    requireWritableCalendar(crmDefault, input.ownerUserId)
    if (input.timeZone) assertValidIanaTimeZone(input.timeZone)

    const newlyVisible = calendars.filter((calendar) => !calendar.visible)
    await tx.calendarSource.updateMany({
      where: { integrationId: integration.id, id: { notIn: visibleCalendarIds } },
      data: { visible: false, crmDefault: false },
    })
    await tx.calendarSource.updateMany({
      where: { integrationId: integration.id, id: { in: visibleCalendarIds }, visible: false },
      data: { visible: true, syncStatus: 'PENDING', lastErrorCode: null },
    })
    await tx.calendarSource.updateMany({
      where: { integrationId: integration.id, crmDefault: true, id: { not: input.crmDefaultCalendarId } },
      data: { crmDefault: false },
    })
    await tx.calendarSource.update({ where: { id: input.crmDefaultCalendarId }, data: { visible: true, crmDefault: true } })

    for (const calendar of newlyVisible) {
      // updatedAt identifies this disabled -> enabled transition. Concurrent
      // PATCH retries compute the same key, while a future re-enable gets a
      // new key because hiding the source advances updatedAt.
      const idempotencyKey =
        `calendar:visibility:${calendar.id}:enabled-after:${calendar.updatedAt.toISOString()}`
      await tx.calendarSyncJob.upsert({
        where: { idempotencyKey },
        create: {
          integrationId: integration.id,
          calendarId: calendar.id,
          direction: 'INBOUND',
          operation: calendar.syncToken ? 'INCREMENTAL_SYNC' : 'FULL_SYNC',
          idempotencyKey,
        },
        update: {},
      })
    }
    if (input.timeZone) await tx.user.update({ where: { id: input.ownerUserId }, data: { timeZone: input.timeZone } })
    const connection = await tx.calendarIntegration.findUniqueOrThrow({ where: { id: integration.id }, select: calendarConnectionSelect })
    return toCalendarConnectionView(connection)
  })
}

export async function getCalendarNotificationRelationForUser(
  input: { ownerUserId: string; eventId: string },
  db: CalendarReadDb = prisma,
): Promise<CalendarNotificationRelation> {
  const event = await db.calendarEvent.findFirst({
    where: ownedCalendarEventWhere(input.ownerUserId, input.eventId),
    select: { id: true, insuranceCaseId: true },
  })
  if (!event) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
  return {
    recipientUserId: input.ownerUserId,
    calendarEventId: event.id,
    caseId: event.insuranceCaseId,
    href: event.insuranceCaseId ? `/agent/cases/${event.insuranceCaseId}` : `/agent/calendar?event=${encodeURIComponent(event.id)}`,
  }
}

export function calendarNotificationDedupeKey(input: {
  type: keyof typeof CALENDAR_NOTIFICATION_TYPES
  eventId: string
  revision: number
  occurrenceAt?: Date
}) {
  requirePositiveRevision(input.revision)
  return [
    'calendar', CALENDAR_NOTIFICATION_TYPES[input.type], input.eventId, `r${input.revision}`,
    input.occurrenceAt?.toISOString() ?? 'event',
  ].join(':')
}

function ownedCalendarEventBase(ownerUserId: string) {
  return {
    ownerUserId,
    integration: { userId: ownerUserId },
    calendar: { integration: { userId: ownerUserId } },
  } as const
}

async function assertOwnedCase(db: Pick<CalendarReadDb, 'insuranceCase'> | Transaction, ownerUserId: string, caseId: string) {
  const insuranceCase = await db.insuranceCase.findFirst({
    where: ownedCaseWhere(ownerUserId, caseId),
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase) {
    throw new CalendarDomainError('CASE_NOT_OWNED', 'Esse lead não pertence ao seu calendário individual.')
  }
  return insuranceCase
}

async function writableCalendar(tx: Transaction, ownerUserId: string, calendarId?: string) {
  const calendar = await tx.calendarSource.findFirst({
    where: {
      id: calendarId,
      crmDefault: calendarId ? undefined : true,
      integration: { userId: ownerUserId, provider: 'GOOGLE' },
    },
    select: { id: true, integrationId: true, accessRole: true, integration: { select: { userId: true, status: true } } },
  })
  if (!calendar) throw new CalendarDomainError('CALENDAR_NOT_FOUND', calendarId ? 'Calendário não encontrado.' : 'Escolha um calendário padrão para o CRM.')
  requireWritableCalendar(calendar, ownerUserId)
  return calendar
}

async function enqueueEventSync(
  tx: Transaction,
  event: Pick<CalendarEventRecord, 'id' | 'integrationId' | 'calendar' | 'localRevision'>,
  operation: 'CREATE_EVENT' | 'UPDATE_EVENT' | 'DELETE_EVENT',
  sendInvites: boolean,
  payload?: Prisma.InputJsonValue,
) {
  const verb = operation === 'CREATE_EVENT' ? 'create' : operation === 'UPDATE_EVENT' ? 'update' : 'delete'
  return tx.calendarSyncJob.create({
    data: {
      integrationId: event.integrationId,
      calendarId: event.calendar.id,
      eventId: event.id,
      direction: 'OUTBOUND',
      operation,
      desiredRevision: event.localRevision,
      sendInvites,
      payload,
      idempotencyKey: `calendar:event:${event.id}:revision:${event.localRevision}:${verb}:invites:${sendInvites ? 1 : 0}`,
    },
    select: { id: true },
  })
}

async function createTimelineEntry(
  tx: Transaction,
  event: Pick<CalendarEventRecord, 'id' | 'insuranceCaseId' | 'title' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate' | 'timeZone' | 'allDay' | 'localRevision'>,
  type: (typeof CALENDAR_TIMELINE_TYPES)[keyof typeof CALENDAR_TIMELINE_TYPES],
  options: {
    previousSchedule?: Pick<CalendarEventRecord, 'allDay' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate' | 'timeZone'>
  } = {},
) {
  if (!event.insuranceCaseId) return
  const schedule = {
    allDay: event.allDay,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    startDate: event.startDate,
    endDate: event.endDate,
    timeZone: event.timeZone,
  }
  const when = formatCalendarScheduleForTimeline(schedule)
  const timelineTitle = {
    [CALENDAR_TIMELINE_TYPES.created]: 'Compromisso criado',
    [CALENDAR_TIMELINE_TYPES.updated]: 'Compromisso atualizado',
    [CALENDAR_TIMELINE_TYPES.cancelled]: 'Compromisso cancelado',
    [CALENDAR_TIMELINE_TYPES.associated]: 'Compromisso associado ao lead',
  }[type]
  await tx.caseTimelineEvent.create({
    data: {
      caseId: event.insuranceCaseId,
      type,
      title: timelineTitle,
      body: options.previousSchedule
        ? `${event.title} · ${calendarRescheduleCopy(options.previousSchedule, schedule)}`
        : `${event.title} · ${when}`,
      metadata: {
        calendarEventId: event.id,
        calendarEventRevision: event.localRevision,
        startsAt: event.allDay ? dateOnly(event.startDate) : iso(event.startsAt),
        ...(options.previousSchedule ? {
          previousStartsAt: options.previousSchedule.allDay
            ? dateOnly(options.previousSchedule.startDate)
            : iso(options.previousSchedule.startsAt),
        } : {}),
      },
    },
    select: { id: true },
  })
}

function optionalText(value: string | null | undefined) {
  return value?.trim() || null
}

function revisionConflict() {
  return new CalendarDomainError('REVISION_CONFLICT', 'Esse compromisso foi alterado em outra sessão. Atualize a agenda e tente novamente.')
}

function compareCalendarEvents(a: CalendarEventView, b: CalendarEventView) {
  const aKey = a.allDay ? `${a.startDate}T00:00:00.000Z` : a.startsAt ?? ''
  const bKey = b.allDay ? `${b.startDate}T00:00:00.000Z` : b.startsAt ?? ''
  return aKey.localeCompare(bKey) || a.title.localeCompare(b.title)
}
