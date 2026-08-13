import type { Prisma } from '@prisma/client'
import { googleEventIdForLocalEvent, googleMeetRequestId } from './idempotency'
import type {
  GoogleCalendarEvent,
  GoogleEventAttendee,
  GoogleEventReminders,
  GoogleEventWrite,
} from './types'

export type LocalCalendarEventForGoogle = {
  id: string
  localRevision: number
  title: string
  description: string | null
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  timeZone: string | null
  location: string | null
  colorId: string | null
  visibility: string | null
  transparency: string | null
  recurrence: string[]
  conferenceData: Prisma.JsonValue | null
  reminders: Prisma.JsonValue | null
  attendees: Array<{ email: string; name: string | null }>
}

export type MappedGoogleEvent = {
  providerEventId: string
  providerRecurringEventId: string | null
  providerOriginalStartAt: Date | null
  providerOriginalStartDate: Date | null
  recurrence: string[]
  iCalUid: string | null
  etag: string | null
  sequence: number | null
  title: string
  description: string | null
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  timeZone: string | null
  allDay: boolean
  location: string | null
  meetingUrl: string | null
  conferenceData: Prisma.JsonValue | null
  reminders: Prisma.JsonValue | null
  colorId: string | null
  visibility: string | null
  transparency: string | null
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
  providerUpdatedAt: Date | null
  deletedAt: Date | null
  attendees: Array<{
    email: string
    name: string | null
    responseStatus: 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
    isSelf: boolean
    isOrganizer: boolean
  }>
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function dateFromGoogle(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function instantFromGoogle(value: string | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function attendeeStatus(status: GoogleEventAttendee['responseStatus']) {
  if (status === 'accepted') return 'ACCEPTED' as const
  if (status === 'declined') return 'DECLINED' as const
  if (status === 'tentative') return 'TENTATIVE' as const
  return 'NEEDS_ACTION' as const
}

function eventStatus(status: GoogleCalendarEvent['status']) {
  if (status === 'cancelled') return 'CANCELLED' as const
  if (status === 'tentative') return 'TENTATIVE' as const
  return 'CONFIRMED' as const
}

function safeJson(value: unknown): Prisma.JsonValue | null {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue
}

function meetingUrl(event: GoogleCalendarEvent) {
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri ??
    null
  )
}

export function mapGoogleEvent(event: GoogleCalendarEvent, now = new Date()): MappedGoogleEvent {
  const allDay = Boolean(event.start?.date)
  const startsAt = allDay ? null : instantFromGoogle(event.start?.dateTime)
  const endsAt = allDay ? null : instantFromGoogle(event.end?.dateTime)
  const startDate = allDay ? dateFromGoogle(event.start?.date) : null
  const endDate = allDay ? dateFromGoogle(event.end?.date) : null
  const originalAllDay = Boolean(event.originalStartTime?.date)
  return {
    providerEventId: event.id,
    providerRecurringEventId: event.recurringEventId ?? null,
    providerOriginalStartAt: originalAllDay
      ? null
      : instantFromGoogle(event.originalStartTime?.dateTime),
    providerOriginalStartDate: originalAllDay
      ? dateFromGoogle(event.originalStartTime?.date)
      : null,
    recurrence: event.recurrence ?? [],
    iCalUid: event.iCalUID ?? null,
    etag: event.etag ?? null,
    sequence: event.sequence ?? null,
    title: event.summary?.trim() || '(Sem título)',
    description: event.description?.trim() || null,
    startsAt,
    endsAt,
    startDate,
    endDate,
    timeZone: event.start?.timeZone ?? event.end?.timeZone ?? null,
    allDay,
    location: event.location?.trim() || null,
    meetingUrl: meetingUrl(event),
    conferenceData: safeJson(event.conferenceData),
    reminders: safeJson(event.reminders),
    colorId: event.colorId ?? null,
    visibility: event.visibility ?? null,
    transparency: event.transparency ?? null,
    status: eventStatus(event.status),
    providerUpdatedAt: instantFromGoogle(event.updated),
    deletedAt: event.status === 'cancelled' ? now : null,
    attendees: (event.attendees ?? [])
      .filter((attendee): attendee is GoogleEventAttendee & { email: string } => Boolean(attendee.email))
      .map((attendee) => ({
        email: attendee.email.toLowerCase(),
        name: attendee.displayName?.trim() || null,
        responseStatus: attendeeStatus(attendee.responseStatus),
        isSelf: Boolean(attendee.self),
        isOrganizer: Boolean(attendee.organizer),
      })),
  }
}

function remindersFromJson(value: Prisma.JsonValue | null): GoogleEventReminders | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const useDefault = typeof record.useDefault === 'boolean' ? record.useDefault : undefined
  const overrides = Array.isArray(record.overrides)
    ? record.overrides.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const raw = item as Record<string, unknown>
        if ((raw.method !== 'email' && raw.method !== 'popup') || !Number.isInteger(raw.minutes)) {
          return []
        }
        return [{
          method: raw.method as 'email' | 'popup',
          minutes: raw.minutes as number,
        }]
      })
    : undefined
  return { useDefault, overrides }
}

function wantsGoogleMeet(value: Prisma.JsonValue | null) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).createMeetRequested === true,
  )
}

export function mapLocalEventToGoogle(event: LocalCalendarEventForGoogle): GoogleEventWrite {
  if (event.allDay) {
    if (!event.startDate || !event.endDate) throw new Error('All-day event dates are required')
  } else if (!event.startsAt || !event.endsAt || !event.timeZone) {
    throw new Error('Timed event instants and IANA timezone are required')
  }
  const createMeet = wantsGoogleMeet(event.conferenceData)
  return {
    id: googleEventIdForLocalEvent(event.id),
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    colorId: event.colorId ?? undefined,
    visibility: event.visibility ?? undefined,
    transparency: event.transparency ?? undefined,
    start: event.allDay
      ? { date: dateOnly(event.startDate!) }
      : { dateTime: event.startsAt!.toISOString(), timeZone: event.timeZone! },
    end: event.allDay
      ? { date: dateOnly(event.endDate!) }
      : { dateTime: event.endsAt!.toISOString(), timeZone: event.timeZone! },
    recurrence: event.recurrence.length ? event.recurrence : undefined,
    attendees: event.attendees.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.name ?? undefined,
    })),
    reminders: remindersFromJson(event.reminders),
    conferenceData: createMeet
      ? {
          createRequest: {
            requestId: googleMeetRequestId(event.id, event.localRevision),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        }
      : undefined,
  }
}
