import { CALENDAR_WRITABLE_ACCESS_ROLES, MAX_CALENDAR_ATTENDEES, MAX_CALENDAR_EVENT_TITLE_LENGTH } from './constants'
import { assertCalendarRange, assertValidIanaTimeZone, parseCalendarDate } from './time'
import type { CalendarAttendeeInput, CalendarRangeInput, CalendarScheduleInput } from './types'

export type CalendarDomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'CONNECTION_NOT_FOUND'
  | 'CONNECTION_NOT_READY'
  | 'CALENDAR_NOT_FOUND'
  | 'CALENDAR_NOT_WRITABLE'
  | 'EVENT_NOT_FOUND'
  | 'CASE_NOT_OWNED'
  | 'REVISION_CONFLICT'

export class CalendarDomainError extends Error {
  constructor(public readonly code: CalendarDomainErrorCode, message: string) {
    super(message)
    this.name = 'CalendarDomainError'
  }
}

export function ownedCalendarEventWhere(ownerUserId: string, eventId: string) {
  requireIdentifier(ownerUserId, 'ownerUserId')
  requireIdentifier(eventId, 'eventId')
  return {
    id: eventId,
    ownerUserId,
    integration: { userId: ownerUserId },
    calendar: { integration: { userId: ownerUserId } },
  } as const
}

export function ownedCaseWhere(ownerUserId: string, caseId: string) {
  requireIdentifier(ownerUserId, 'ownerUserId')
  requireIdentifier(caseId, 'caseId')
  return { id: caseId, assignedAgent: { userId: ownerUserId } } as const
}

export function validateCalendarRangeInput(input: CalendarRangeInput) {
  requireIdentifier(input.ownerUserId, 'ownerUserId')
  try {
    assertCalendarRange(input.start, input.end)
  } catch (error) {
    throw new CalendarDomainError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid calendar range')
  }
}

export function requireWritableCalendar(value: { accessRole: string | null; integration: { status: string; userId: string } }, ownerUserId: string) {
  if (value.integration.userId !== ownerUserId) throw new CalendarDomainError('CALENDAR_NOT_FOUND', 'Calendário não encontrado.')
  if (value.integration.status !== 'CONNECTED') throw new CalendarDomainError('CONNECTION_NOT_READY', 'Reconecte o Google Calendar antes de alterar eventos.')
  if (!value.accessRole || !(CALENDAR_WRITABLE_ACCESS_ROLES as readonly string[]).includes(value.accessRole)) {
    throw new CalendarDomainError('CALENDAR_NOT_WRITABLE', 'Esse calendário é somente leitura.')
  }
}

export function normalizeEventTitle(value: string) {
  const title = value.trim()
  if (!title) throw new CalendarDomainError('VALIDATION_ERROR', 'Informe um título para o compromisso.')
  if (title.length > MAX_CALENDAR_EVENT_TITLE_LENGTH) {
    throw new CalendarDomainError('VALIDATION_ERROR', `O título pode ter no máximo ${MAX_CALENDAR_EVENT_TITLE_LENGTH} caracteres.`)
  }
  return title
}

export function normalizeAttendees(input: CalendarAttendeeInput[] = []) {
  if (input.length > MAX_CALENDAR_ATTENDEES) throw new CalendarDomainError('VALIDATION_ERROR', 'Há participantes demais nesse compromisso.')
  const byEmail = new Map<string, CalendarAttendeeInput>()
  for (const attendee of input) {
    const email = attendee.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CalendarDomainError('VALIDATION_ERROR', `E-mail de participante inválido: ${attendee.email}`)
    byEmail.set(email, { email, name: attendee.name?.trim() || null })
  }
  return [...byEmail.values()]
}

export function scheduleData(schedule: CalendarScheduleInput) {
  if (schedule.allDay) {
    let startDate: Date
    let endDate: Date
    try {
      startDate = parseCalendarDate(schedule.startDate)
      endDate = parseCalendarDate(schedule.endDate)
      if (endDate <= startDate) throw new Error('Invalid all-day interval')
      if (schedule.timeZone) assertValidIanaTimeZone(schedule.timeZone)
    } catch (error) {
      throw new CalendarDomainError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid all-day interval')
    }
    return { allDay: true, startDate, endDate, startsAt: null, endsAt: null, timeZone: schedule.timeZone ?? null } as const
  }
  try {
    assertCalendarRange(schedule.startsAt, schedule.endsAt)
    assertValidIanaTimeZone(schedule.timeZone)
  } catch (error) {
    throw new CalendarDomainError('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid event interval')
  }
  return { allDay: false, startsAt: schedule.startsAt, endsAt: schedule.endsAt, startDate: null, endDate: null, timeZone: schedule.timeZone } as const
}

export function requirePositiveRevision(value: number) {
  if (!Number.isInteger(value) || value < 1) throw new CalendarDomainError('VALIDATION_ERROR', 'Revisão de evento inválida.')
}

function requireIdentifier(value: string, field: string) {
  if (!value?.trim()) throw new CalendarDomainError('VALIDATION_ERROR', `${field} is required`)
}
