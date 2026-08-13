import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GOOGLE_CALENDAR_OPTIONAL_SCOPES } from '../constants'
import { GoogleCalendarClient } from './client'
import { getGoogleAccessToken } from './credentials'
import type { GoogleCalendarEnv } from './env'
import type { GoogleFetch } from './http'

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
        where: { visible: true },
        select: { id: true, providerCalendarId: true },
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
    for (const [providerCalendarId, calendar] of Object.entries(response.calendars)) {
      if (calendar.errors?.length) {
        throw new Error(`Google FreeBusy failed for calendar ${providerCalendarId}`)
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
