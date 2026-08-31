export type CalendarEventDetails = {
  id: string
  title: string
  ownerName: string
  startsAt: string | Date
  endsAt: string | Date
  timeZone: string
  meetingUrl?: string | null
}

const CALENDAR_LOCATION = 'Google Meet'

function validDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('Data de calendário inválida.')
  return date
}

function safeMeetingUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function formatCalendarUtc(value: string | Date) {
  return validDate(value).toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')
}

function calendarDescription(details: CalendarEventDetails) {
  const meetingUrl = safeMeetingUrl(details.meetingUrl)
  return meetingUrl
    ? `Reunião com ${details.ownerName}. Acesse pelo Google Meet: ${meetingUrl}`
    : `Reunião com ${details.ownerName}. O link do Google Meet será enviado pelo convite oficial do Google Agenda.`
}

function calendarDates(details: CalendarEventDetails) {
  const startsAt = validDate(details.startsAt)
  const endsAt = validDate(details.endsAt)
  if (endsAt <= startsAt) throw new RangeError('O fim do agendamento deve ser posterior ao início.')
  return { startsAt, endsAt }
}

function escapeIcsText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
}

function foldIcsLine(line: string) {
  const encoder = new TextEncoder()
  const folded: string[] = []
  let current = ''
  let currentBytes = 0

  for (const character of line) {
    const characterBytes = encoder.encode(character).length
    const byteLimit = folded.length === 0 ? 75 : 74
    if (current && currentBytes + characterBytes > byteLimit) {
      folded.push(`${folded.length ? ' ' : ''}${current}`)
      current = character
      currentBytes = characterBytes
      continue
    }
    current += character
    currentBytes += characterBytes
  }

  if (current || folded.length === 0) folded.push(`${folded.length ? ' ' : ''}${current}`)
  return folded
}

export function buildGoogleCalendarUrl(details: CalendarEventDetails) {
  const { startsAt, endsAt } = calendarDates(details)
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('text', details.title)
  url.searchParams.set('dates', `${formatCalendarUtc(startsAt)}/${formatCalendarUtc(endsAt)}`)
  url.searchParams.set('details', calendarDescription(details))
  url.searchParams.set('location', safeMeetingUrl(details.meetingUrl) ?? CALENDAR_LOCATION)
  url.searchParams.set('ctz', details.timeZone)
  return url.toString()
}

export function buildOutlookCalendarUrl(details: CalendarEventDetails) {
  const { startsAt, endsAt } = calendarDates(details)
  const url = new URL('https://outlook.live.com/calendar/deeplink/compose')
  url.searchParams.set('path', '/calendar/action/compose')
  url.searchParams.set('rru', 'addevent')
  url.searchParams.set('allday', 'false')
  url.searchParams.set('subject', details.title)
  url.searchParams.set('startdt', startsAt.toISOString())
  url.searchParams.set('enddt', endsAt.toISOString())
  url.searchParams.set('body', calendarDescription(details))
  url.searchParams.set('location', safeMeetingUrl(details.meetingUrl) ?? CALENDAR_LOCATION)
  return url.toString()
}

export function buildIcsCalendar(details: CalendarEventDetails, generatedAt = new Date()) {
  const { startsAt, endsAt } = calendarDates(details)
  const safeId = details.id.replace(/[^A-Za-z0-9._-]/g, '_') || 'booking'
  const meetingUrl = safeMeetingUrl(details.meetingUrl)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Keepr One//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${safeId}@calendar.keeprone.com`,
    `DTSTAMP:${formatCalendarUtc(generatedAt)}`,
    `DTSTART:${formatCalendarUtc(startsAt)}`,
    `DTEND:${formatCalendarUtc(endsAt)}`,
    `SUMMARY:${escapeIcsText(details.title)}`,
    `DESCRIPTION:${escapeIcsText(calendarDescription(details))}`,
    `LOCATION:${escapeIcsText(CALENDAR_LOCATION)}`,
    ...(meetingUrl ? [`URL:${meetingUrl}`] : []),
    'STATUS:CONFIRMED',
    'CLASS:PRIVATE',
    'TRANSP:OPAQUE',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`
}

export function calendarExportFilename(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '')
  return `${slug || 'agendamento-keepr-one'}.ics`
}

export function downloadIcsCalendar(details: CalendarEventDetails) {
  const blob = new Blob([buildIcsCalendar(details)], {
    type: 'text/calendar;charset=utf-8;method=PUBLISH',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = calendarExportFilename(details.title)
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000)
}
