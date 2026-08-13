import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CalendarDomainError, ownedCalendarEventWhere, scheduleData } from './access'
import { getCalendarEventsForRange } from './repository'
import { zonedDateTimeToUtc } from './time'
import type { CalendarScheduleInput } from './types'
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from './google/env'
import { getGoogleFreeBusyForUser, GoogleFreeBusyPermissionMissingError } from './google/freebusy'

const CONFLICT_OVERRIDE_TTL_MS = 5 * 60_000

export type CalendarSchedulingConflict = {
  id: string
  title: string
  startsAt: string
  endsAt: string
}

export type CalendarConflictGuardResult =
  | { ok: true; conflicts: [] }
  | {
      ok: false
      code: 'SCHEDULE_CONFLICT'
      message: string
      conflicts: CalendarSchedulingConflict[]
      conflictOverrideToken: string
    }

type EventScheduleRecord = {
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  timeZone: string | null
}

type ConflictDb = Pick<PrismaClient, 'calendarEvent'>

type ConflictGuardDependencies = {
  db?: ConflictDb
  now?: () => number
  secret?: () => string | undefined
  googleConfigured?: () => boolean
  googleEnv?: typeof getGoogleCalendarEnv
  getEvents?: typeof getCalendarEventsForRange
  getFreeBusy?: typeof getGoogleFreeBusyForUser
}

type ConflictProofPayload = {
  version: 1
  ownerUserId: string
  eventId: string | null
  startsAt: string
  endsAt: string
  expiresAt: number
}

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new CalendarDomainError('VALIDATION_ERROR', 'Data do compromisso inválida.')
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function boundsForSchedule(schedule: CalendarScheduleInput, userTimeZone: string) {
  const normalized = scheduleData(schedule)
  if (!normalized.allDay) {
    return { start: normalized.startsAt, end: normalized.endsAt }
  }
  const timeZone = normalized.timeZone ?? userTimeZone
  return {
    start: zonedDateTimeToUtc({ ...dateParts(dateOnly(normalized.startDate)), hour: 0, minute: 0, second: 0 }, timeZone),
    end: zonedDateTimeToUtc({ ...dateParts(dateOnly(normalized.endDate)), hour: 0, minute: 0, second: 0 }, timeZone),
  }
}

function scheduleFromRecord(record: EventScheduleRecord, userTimeZone: string): CalendarScheduleInput {
  if (record.allDay) {
    if (!record.startDate || !record.endDate) {
      throw new CalendarDomainError('VALIDATION_ERROR', 'Período do compromisso inválido.')
    }
    return {
      allDay: true,
      startDate: dateOnly(record.startDate),
      endDate: dateOnly(record.endDate),
      timeZone: record.timeZone ?? userTimeZone,
    }
  }
  if (!record.startsAt || !record.endsAt) {
    throw new CalendarDomainError('VALIDATION_ERROR', 'Período do compromisso inválido.')
  }
  return {
    allDay: false,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    timeZone: record.timeZone ?? userTimeZone,
  }
}

async function ownedEventSchedule(
  ownerUserId: string,
  eventId: string,
  userTimeZone: string,
  db: ConflictDb,
) {
  const event = await db.calendarEvent.findFirst({
    where: {
      ...ownedCalendarEventWhere(ownerUserId, eventId),
      deletedAt: null,
      status: { not: 'CANCELLED' },
    },
    select: {
      allDay: true,
      startsAt: true,
      endsAt: true,
      startDate: true,
      endDate: true,
      timeZone: true,
    },
  })
  if (!event) throw new CalendarDomainError('EVENT_NOT_FOUND', 'Compromisso não encontrado.')
  return scheduleFromRecord(event, userTimeZone)
}

function secretFrom(dependencies: ConflictGuardDependencies) {
  return dependencies.secret?.() ?? process.env.BETTER_AUTH_SECRET
}

function proofPayload(
  input: { ownerUserId: string; eventId?: string; start: Date; end: Date },
  expiresAt: number,
): ConflictProofPayload {
  return {
    version: 1,
    ownerUserId: input.ownerUserId,
    eventId: input.eventId ?? null,
    startsAt: input.start.toISOString(),
    endsAt: input.end.toISOString(),
    expiresAt,
  }
}

function createConflictOverrideToken(
  input: { ownerUserId: string; eventId?: string; start: Date; end: Date },
  dependencies: ConflictGuardDependencies,
) {
  const secret = secretFrom(dependencies)
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for calendar conflict overrides')
  const now = dependencies.now?.() ?? Date.now()
  const encoded = Buffer.from(JSON.stringify(proofPayload(input, now + CONFLICT_OVERRIDE_TTL_MS))).toString('base64url')
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function validConflictOverrideToken(
  token: string | undefined,
  input: { ownerUserId: string; eventId?: string; start: Date; end: Date },
  dependencies: ConflictGuardDependencies,
) {
  if (!token) return false
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return false
  const secret = secretFrom(dependencies)
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(encoded).digest()
  let actual: Buffer
  let payload: ConflictProofPayload
  try {
    actual = Buffer.from(signature, 'base64url')
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConflictProofPayload
  } catch {
    return false
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false
  const now = dependencies.now?.() ?? Date.now()
  return payload.version === 1 &&
    payload.ownerUserId === input.ownerUserId &&
    payload.eventId === (input.eventId ?? null) &&
    payload.startsAt === input.start.toISOString() &&
    payload.endsAt === input.end.toISOString() &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt >= now &&
    payload.expiresAt <= now + CONFLICT_OVERRIDE_TTL_MS
}

export async function getCalendarSchedulingConflicts(
  input: { ownerUserId: string; start: Date; end: Date; timeZone: string; excludeEventId?: string },
  dependencies: ConflictGuardDependencies = {},
) {
  const getEvents = dependencies.getEvents ?? getCalendarEventsForRange
  const getFreeBusy = dependencies.getFreeBusy ?? getGoogleFreeBusyForUser
  const configured = dependencies.googleConfigured?.() ?? isGoogleCalendarConfigured()
  const liveBusy = configured
    ? getFreeBusy(
        { ownerUserId: input.ownerUserId, start: input.start, end: input.end, timeZone: input.timeZone },
        (dependencies.googleEnv ?? getGoogleCalendarEnv)(),
      ).catch((error: unknown) => {
        // FreeBusy is a granular optional scope. Keep local conflict protection
        // functional when a user granted event CRUD but declined availability.
        if (error instanceof GoogleFreeBusyPermissionMissingError) {
          return { connected: false, intervals: [] }
        }
        throw error
      })
    : Promise.resolve({ connected: false, intervals: [] })
  const [events, live] = await Promise.all([
    getEvents({ ownerUserId: input.ownerUserId, start: input.start, end: input.end }),
    liveBusy,
  ])
  const local = events.filter((event) => event.id !== input.excludeEventId)
  const knownIntervals = local.flatMap((event) =>
    !event.allDay && event.startsAt && event.endsAt
      ? [{ start: new Date(event.startsAt), end: new Date(event.endsAt) }]
      : [],
  )
  const providerOnly = live.intervals.filter((busy) => !knownIntervals.some((known) =>
    known.start < busy.end && known.end > busy.start,
  ))
  return [
    ...local.map((event) => ({
      id: event.id,
      title: event.title,
      startsAt: event.startsAt ?? `${event.startDate}T00:00:00.000Z`,
      endsAt: event.endsAt ?? `${event.endDate}T00:00:00.000Z`,
    })),
    ...providerOnly.map((busy, index) => ({
      id: `google-busy-${busy.calendarSourceId}-${index}`,
      title: 'Ocupado no Google Calendar',
      startsAt: busy.start.toISOString(),
      endsAt: busy.end.toISOString(),
    })),
  ] satisfies CalendarSchedulingConflict[]
}

/**
 * Single server-side scheduling gate shared by Server Actions and REST writes.
 * An override is accepted only after this same owner/event/range produced a
 * conflict and the user resubmits the short-lived signed proof explicitly.
 */
export async function checkCalendarConflictPolicy(
  input: {
    ownerUserId: string
    eventId?: string
    schedule?: CalendarScheduleInput
    userTimeZone: string
    allowConflict?: boolean
    conflictOverrideToken?: string
  },
  dependencies: ConflictGuardDependencies = {},
): Promise<CalendarConflictGuardResult> {
  if (!input.ownerUserId.trim()) throw new CalendarDomainError('VALIDATION_ERROR', 'ownerUserId is required')
  // Authenticate event ownership even when PATCH supplies a replacement
  // schedule, before availability details or a signed proof are returned.
  const existingSchedule = input.eventId
    ? await ownedEventSchedule(input.ownerUserId, input.eventId, input.userTimeZone, dependencies.db ?? prisma)
    : undefined
  const schedule = input.schedule ?? existingSchedule
  if (!schedule) throw new CalendarDomainError('VALIDATION_ERROR', 'Informe o período do compromisso.')
  const bounds = boundsForSchedule(schedule, input.userTimeZone)
  const proofInput = { ownerUserId: input.ownerUserId, eventId: input.eventId, ...bounds }
  const conflicts = await getCalendarSchedulingConflicts(
    { ownerUserId: input.ownerUserId, ...bounds, timeZone: input.userTimeZone, excludeEventId: input.eventId },
    dependencies,
  )
  if (!conflicts.length || (
    input.allowConflict && validConflictOverrideToken(input.conflictOverrideToken, proofInput, dependencies)
  )) {
    return { ok: true, conflicts: [] }
  }
  return {
    ok: false,
    code: 'SCHEDULE_CONFLICT',
    message: conflicts.length === 1
      ? 'Já existe um compromisso nesse horário.'
      : `Existem ${conflicts.length} compromissos nesse horário.`,
    conflicts,
    conflictOverrideToken: createConflictOverrideToken(proofInput, dependencies),
  }
}
