export const CRM_TIME_ZONE = 'America/New_York'

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function zonedParts(date: Date, timeZone = CRM_TIME_ZONE): DateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') }
}

function zoneOffsetMs(date: Date, timeZone = CRM_TIME_ZONE) {
  const p = zonedParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

export function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone = CRM_TIME_ZONE,
) {
  const hour = input.hour ?? 9
  const minute = input.minute ?? 0
  const second = input.second ?? 0
  const normalized = new Date(Date.UTC(input.year, input.month - 1, input.day, hour, minute, second))
  if (
    !Number.isInteger(input.year) || input.year < 1900 || input.year > 9999 ||
    !Number.isInteger(input.month) || input.month < 1 || input.month > 12 ||
    !Number.isInteger(input.day) || input.day < 1 || input.day > 31 ||
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59 ||
    normalized.getUTCFullYear() !== input.year ||
    normalized.getUTCMonth() + 1 !== input.month ||
    normalized.getUTCDate() !== input.day
  ) {
    throw new Error('Invalid CRM local date/time')
  }

  const wallClock = normalized.getTime()
  let utc = wallClock - zoneOffsetMs(new Date(wallClock), timeZone)
  // Second pass handles the boundary around a DST transition.
  utc = wallClock - zoneOffsetMs(new Date(utc), timeZone)
  const result = new Date(utc)
  const resolved = zonedParts(result, timeZone)
  if (
    resolved.year !== input.year || resolved.month !== input.month || resolved.day !== input.day ||
    resolved.hour !== hour || resolved.minute !== minute || resolved.second !== second
  ) {
    // Spring-forward wall clocks such as 02:30 do not exist. Failing closed is
    // safer than silently moving a customer's reminder by an hour.
    throw new Error('Invalid CRM local date/time')
  }
  return result
}

export function nyDayBounds(now = new Date()) {
  const p = zonedParts(now)
  const start = zonedDateTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0 })
  const noon = new Date(start.getTime() + 36 * 60 * 60 * 1000)
  const next = zonedParts(noon)
  const end = zonedDateTimeToUtc({ year: next.year, month: next.month, day: next.day, hour: 0 })
  return { start, end }
}

export function quickFollowUpDate(daysFromToday: number, now = new Date(), hour = 9, minute = 0) {
  if (!Number.isInteger(daysFromToday) || daysFromToday < 0) throw new Error('daysFromToday must be a non-negative integer')
  const current = zonedParts(now)
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + daysFromToday, 12))
  return zonedDateTimeToUtc({
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour, minute,
  })
}

export function formatCrmDateTime(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: CRM_TIME_ZONE, dateStyle: 'long', timeStyle: 'short',
  }).format(date)
}

/// Accepts HTML date/datetime-local values as New York wall-clock time. A
/// date-only reminder intentionally lands at 09:00, never UTC midnight.
export function parseCrmLocalDateTime(value: string, defaultHour = 9) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value.trim())
  if (!match) throw new Error('Invalid CRM local date/time')
  return zonedDateTimeToUtc({
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: match[4] === undefined ? defaultHour : Number(match[4]),
    minute: match[5] === undefined ? 0 : Number(match[5]),
  })
}
