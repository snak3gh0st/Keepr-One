import type { CalendarAttendeeResponse } from './types'

export type CalendarScheduleSnapshot = {
  allDay: boolean
  startsAt: Date | null
  endsAt: Date | null
  startDate: Date | null
  endDate: Date | null
  timeZone: string | null
}

const ATTENDEE_RESPONSE_COPY: Record<CalendarAttendeeResponse, string> = {
  ACCEPTED: 'confirmou presença',
  DECLINED: 'recusou o convite',
  TENTATIVE: 'respondeu talvez',
  NEEDS_ACTION: 'voltou a aguardar resposta',
}

function dateOnly(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null
}

function safeTimeZone(value: string | null | undefined) {
  if (!value) return 'UTC'
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(new Date(0))
    return value
  } catch {
    return 'UTC'
  }
}

export function formatCalendarScheduleForTimeline(value: CalendarScheduleSnapshot) {
  if (value.allDay) {
    const start = dateOnly(value.startDate)
    const exclusiveEnd = dateOnly(value.endDate)
    if (!start) return 'data a definir'
    if (!exclusiveEnd || exclusiveEnd === start) return `${start} · dia inteiro`
    const inclusiveEnd = new Date(`${exclusiveEnd}T00:00:00.000Z`)
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1)
    const end = inclusiveEnd.toISOString().slice(0, 10)
    return end === start ? `${start} · dia inteiro` : `${start} a ${end} · dia inteiro`
  }
  if (!value.startsAt) return 'horário a definir'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: safeTimeZone(value.timeZone),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value.startsAt)
}

export function calendarRescheduleCopy(previous: CalendarScheduleSnapshot, next: CalendarScheduleSnapshot) {
  return `De ${formatCalendarScheduleForTimeline(previous)} para ${formatCalendarScheduleForTimeline(next)}.`
}

export function calendarScheduleChanged(previous: CalendarScheduleSnapshot, next: CalendarScheduleSnapshot) {
  const sameInstant = (left: Date | null, right: Date | null) => left?.getTime() === right?.getTime()
  return (
    previous.allDay !== next.allDay ||
    !sameInstant(previous.startsAt, next.startsAt) ||
    !sameInstant(previous.endsAt, next.endsAt) ||
    !sameInstant(previous.startDate, next.startDate) ||
    !sameInstant(previous.endDate, next.endDate) ||
    previous.timeZone !== next.timeZone
  )
}

export function attendeeResponseCopy(email: string, status: CalendarAttendeeResponse) {
  return `${email} ${ATTENDEE_RESPONSE_COPY[status]}.`
}
