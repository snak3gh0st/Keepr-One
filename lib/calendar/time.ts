import { DEFAULT_CALENDAR_TIME_ZONE, MAX_CALENDAR_RANGE_DAYS } from './constants'

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function isValidIanaTimeZone(value: string): boolean {
  if (!value || value !== value.trim() || value.length > 100 || value.includes('\0')) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export function assertValidIanaTimeZone(value: string): string {
  if (!isValidIanaTimeZone(value)) throw new Error('Invalid IANA time zone')
  return value
}

export function zonedParts(date: Date, timeZone = DEFAULT_CALENDAR_TIME_ZONE): DateParts {
  assertValidDate(date)
  assertValidIanaTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') }
}

function zoneOffsetMs(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

export function zonedDateTimeToUtc(input: DateParts, timeZone: string): Date {
  assertValidIanaTimeZone(timeZone)
  const normalized = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second))
  if (
    !Number.isInteger(input.year) || input.year < 1900 || input.year > 9999 ||
    !Number.isInteger(input.month) || input.month < 1 || input.month > 12 ||
    !Number.isInteger(input.day) || input.day < 1 || input.day > 31 ||
    !Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23 ||
    !Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59 ||
    !Number.isInteger(input.second) || input.second < 0 || input.second > 59 ||
    normalized.getUTCFullYear() !== input.year || normalized.getUTCMonth() + 1 !== input.month || normalized.getUTCDate() !== input.day
  ) throw new Error('Invalid local calendar date/time')

  const wallClock = normalized.getTime()
  let utc = wallClock - zoneOffsetMs(new Date(wallClock), timeZone)
  utc = wallClock - zoneOffsetMs(new Date(utc), timeZone)
  const result = new Date(utc)
  const resolved = zonedParts(result, timeZone)
  if (Object.keys(input).some((key) => resolved[key as keyof DateParts] !== input[key as keyof DateParts])) {
    throw new Error('Invalid local calendar date/time')
  }
  return result
}

export function dayBoundsInTimeZone(now = new Date(), timeZone = DEFAULT_CALENDAR_TIME_ZONE) {
  const local = zonedParts(now, timeZone)
  const start = zonedDateTimeToUtc({ ...local, hour: 0, minute: 0, second: 0 }, timeZone)
  const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, 12))
  const end = zonedDateTimeToUtc({
    year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() + 1, day: nextDate.getUTCDate(),
    hour: 0, minute: 0, second: 0,
  }, timeZone)
  return { start, end }
}

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone)
  return `${p.year.toString().padStart(4, '0')}-${p.month.toString().padStart(2, '0')}-${p.day.toString().padStart(2, '0')}`
}

export function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Invalid calendar date')
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date')
  return date
}

export function addCalendarDays(value: string, days: number) {
  const date = parseCalendarDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dateRangeForInstants(start: Date, end: Date, timeZone: string) {
  assertCalendarRange(start, end)
  const startDate = dateKeyInTimeZone(start, timeZone)
  const inclusiveEndDate = dateKeyInTimeZone(new Date(end.getTime() - 1), timeZone)
  return { startDate: parseCalendarDate(startDate), endDate: parseCalendarDate(addCalendarDays(inclusiveEndDate, 1)) }
}

export function assertCalendarRange(start: Date, end: Date) {
  assertValidDate(start)
  assertValidDate(end)
  if (end <= start) throw new Error('Calendar range end must be after start')
  if (end.getTime() - start.getTime() > MAX_CALENDAR_RANGE_DAYS * 86_400_000) {
    throw new Error(`Calendar range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days`)
  }
}

function assertValidDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Invalid date')
}
