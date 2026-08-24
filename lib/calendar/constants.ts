export const DEFAULT_CALENDAR_TIME_ZONE = 'America/New_York'

export const GOOGLE_CALENDAR_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const

export const GOOGLE_CALENDAR_OPTIONAL_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.freebusy',
] as const

export const CALENDAR_WRITABLE_ACCESS_ROLES = ['owner', 'writer'] as const
export const MAX_CALENDAR_RANGE_DAYS = 400
export const MAX_CALENDAR_EVENT_TITLE_LENGTH = 500
export const MAX_CALENDAR_ATTENDEES = 200

export const CALENDAR_TIMELINE_TYPES = {
  created: 'CALENDAR_EVENT_CREATED',
  updated: 'CALENDAR_EVENT_UPDATED',
  cancelled: 'CALENDAR_EVENT_CANCELLED',
  associated: 'CALENDAR_EVENT_ASSOCIATED',
} as const

export const CALENDAR_NOTIFICATION_TYPES = {
  reminder: 'CALENDAR_EVENT_REMINDER',
  changed: 'CALENDAR_EVENT_CHANGED',
  cancelled: 'CALENDAR_EVENT_CANCELLED',
} as const
