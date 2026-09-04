import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GOOGLE_CALENDAR_OPTIONAL_SCOPES } from '../constants'
import { zonedDateTimeToUtc } from '../time'
import { GoogleCalendarClient } from './client'
import { getGoogleAccessToken } from './credentials'
import type { GoogleCalendarEnv } from './env'
import type { GoogleFetch } from './http'
import type { GoogleCalendarEvent } from './types'

type FreeBusyDb = Pick<
  PrismaClient,
  'calendarIntegration' | 'calendarSource' | 'calendarSyncJob' | '$transaction'
>

export type GoogleBusyInterval = {
  calendarSourceId: string
  providerCalendarId: string
  start: Date
  end: Date
}

export class GoogleFreeBusyPermissionMissingError extends Error {
  readonly code = 'GOOGLE_FREEBUSY_PERMISSION_MISSING'
  constructor() {
    super('Google Calendar availability permission is missing; reconnect the integration')
    this.name = 'GoogleFreeBusyPermissionMissingError'
  }
}

function validInstant(value: string | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function dateOnlyInstant(value: string | undefined, timeZone: string) {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  try {
    return zonedDateTimeToUtc({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: 0,
      minute: 0,
      second: 0,
    }, timeZone)
  } catch {
    return null
  }
}

function dateTimeInstant(value: string | undefined, timeZone: string) {
  if (!value) return null
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return validInstant(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value)
  if (!match) return null
  try {
    return zonedDateTimeToUtc({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] ?? 0),
    }, timeZone)
  } catch {
    return null
  }
}

function liveEventInterval(event: GoogleCalendarEvent, fallbackTimeZone: string) {
  const declinedByOwner = event.attendees?.some(
    (attendee) => attendee.self && attendee.responseStatus === 'declined',
  )
  if (event.status === 'cancelled' || event.transparency === 'transparent' || declinedByOwner) {
    return null
  }
  const startTimeZone = event.start?.timeZone ?? event.end?.timeZone ?? fallbackTimeZone
  const endTimeZone = event.end?.timeZone ?? event.start?.timeZone ?? fallbackTimeZone
  const start = dateTimeInstant(event.start?.dateTime, startTimeZone) ??
    dateOnlyInstant(event.start?.date, startTimeZone)
  const end = dateTimeInstant(event.end?.dateTime, endTimeZone) ??
    dateOnlyInstant(event.end?.date, endTimeZone)
  if (!start || !end || end <= start) {
    throw new Error(`Google returned an invalid event range for ${event.id}`)
  }
  return { start, end }
}

/** Reads live provider availability for only the signed-in user's calendars. */
export async function getGoogleFreeBusyForUser(
  input: { ownerUserId: string; start: Date; end: Date; timeZone: string },
  env: GoogleCalendarEnv,
  options: { fetch?: GoogleFetch; db?: FreeBusyDb } = {},
) {
  if (!input.ownerUserId || !Number.isFinite(input.start.getTime()) ||
      !Number.isFinite(input.end.getTime()) || input.end <= input.start) {
    throw new Error('Invalid Google FreeBusy range')
  }
  const db = options.db ?? prisma
  const integration = await db.calendarIntegration.findUnique({
    where: { userId_provider: { userId: input.ownerUserId, provider: 'GOOGLE' } },
    select: {
      id: true,
      status: true,
      grantedScopes: true,
      calendars: {
        // `visible` is the user's explicit conflict-calendar selection. Keep
        // the CRM default in the live check as a fail-safe for legacy or
        // partially migrated preference rows where it was hidden by mistake.
        where: { OR: [{ visible: true }, { crmDefault: true }] },
        select: { id: true, providerCalendarId: true, timeZone: true },
      },
    },
  })
  if (!integration || integration.status !== 'CONNECTED' || !integration.calendars.length) {
    return { connected: false, intervals: [] as GoogleBusyInterval[] }
  }
  const freeBusyScope = GOOGLE_CALENDAR_OPTIONAL_SCOPES[0]
  if (!integration.grantedScopes.includes(freeBusyScope)) {
    throw new GoogleFreeBusyPermissionMissingError()
  }
  const accessToken = await getGoogleAccessToken(integration.id, env, {
    fetch: options.fetch,
    db,
  })
  const client = new GoogleCalendarClient({ accessToken, fetch: options.fetch })
  const sourceByProvider = new Map(
    integration.calendars.map((calendar) => [calendar.providerCalendarId, calendar.id]),
  )
  const intervals: GoogleBusyInterval[] = []
  for (let index = 0; index < integration.calendars.length; index += 50) {
    const providerIds = integration.calendars
      .slice(index, index + 50)
      .map((calendar) => calendar.providerCalendarId)
    const response = await client.freeBusy({
      timeMin: input.start.toISOString(),
      timeMax: input.end.toISOString(),
      timeZone: input.timeZone,
      calendarIds: providerIds,
    })
    // FreeBusy is a safety boundary for public scheduling. A partial response
    // cannot be interpreted as "free": every requested source must have an
    // explicit, error-free result.
    for (const providerCalendarId of providerIds) {
      const calendar = response.calendars[providerCalendarId]
      if (!calendar) {
        throw new Error(`Google FreeBusy omitted calendar ${providerCalendarId}`)
      }
      if (calendar.errors?.length) {
        const canFallbackToEvents = calendar.errors.every((error) => error.reason === 'notFound')
        if (!canFallbackToEvents) {
          throw new Error(`Google FreeBusy failed for calendar ${providerCalendarId}`)
        }
        // Google public/subscribed calendars can return `notFound` from
        // freeBusy even when events.list is authorized. Use that live range as
        // the source of truth instead of treating a partial response as free.
        const source = integration.calendars.find(
          (item) => item.providerCalendarId === providerCalendarId,
        )
        const liveRange = await client.listEventsInRange({
          calendarId: providerCalendarId,
          timeMin: input.start.toISOString(),
          timeMax: input.end.toISOString(),
        })
        for (const event of liveRange.items) {
          const busy = liveEventInterval(
            event,
            liveRange.timeZone ?? source?.timeZone ?? input.timeZone,
          )
          const calendarSourceId = sourceByProvider.get(providerCalendarId)
          if (busy && calendarSourceId && busy.end > input.start && busy.start < input.end) {
            intervals.push({ calendarSourceId, providerCalendarId, ...busy })
          }
        }
        continue
      }
      for (const busy of calendar.busy ?? []) {
        const start = validInstant(busy.start)
        const end = validInstant(busy.end)
        const calendarSourceId = sourceByProvider.get(providerCalendarId)
        if (start && end && end > start && calendarSourceId) {
          intervals.push({ calendarSourceId, providerCalendarId, start, end })
        }
      }
    }
  }
  return { connected: true, intervals }
}
