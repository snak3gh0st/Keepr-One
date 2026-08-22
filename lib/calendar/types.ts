export type CalendarConnectionStatus = 'CONNECTED' | 'RECONNECT_REQUIRED' | 'ERROR' | 'DISCONNECTED'
export type CalendarEventStatusValue = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'
export type CalendarEventSourceValue = 'CRM' | 'GOOGLE'
export type CalendarSyncStatusValue = 'SYNCED' | 'PENDING' | 'PROCESSING' | 'ERROR'
export type CalendarAttendeeResponse = 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'
export type CalendarRecurrenceMutationScope = 'THIS_EVENT' | 'THIS_AND_FOLLOWING' | 'SERIES'

export type CalendarJson = null | boolean | number | string | CalendarJson[] | { [key: string]: CalendarJson }

export type CalendarSourceView = {
  id: string
  providerCalendarId: string
  name: string
  description: string | null
  backgroundColor: string | null
  foregroundColor: string | null
  isPrimary: boolean
  visible: boolean
  crmDefault: boolean
  accessRole: string | null
  timeZone: string | null
  syncStatus: CalendarSyncStatusValue
  lastSyncedAt: string | null
}

export type CalendarConnectionView = {
  id: string
  provider: 'GOOGLE'
  providerEmail: string
  displayName: string | null
  status: CalendarConnectionStatus
  grantedScopes: string[]
  tokenExpiresAt: string | null
  connectedAt: string
  lastSyncAt: string | null
  lastErrorCode: string | null
  calendars: CalendarSourceView[]
}

export type CalendarEventAttendeeView = {
  id: string
  email: string
  name: string | null
  responseStatus: CalendarAttendeeResponse
  isSelf: boolean
  isOrganizer: boolean
}

export type CalendarEventView = {
  id: string
  ownerUserId: string
  integrationId: string
  calendar: Pick<CalendarSourceView, 'id' | 'providerCalendarId' | 'name' | 'backgroundColor' | 'foregroundColor'>
  caseId: string | null
  providerEventId: string | null
  /** Present for one expanded occurrence of a Google recurring series. */
  providerRecurringEventId: string | null
  title: string
  description: string | null
  allDay: boolean
  startsAt: string | null
  endsAt: string | null
  startDate: string | null
  endDate: string | null
  timeZone: string | null
  location: string | null
  meetingUrl: string | null
  conferenceData: CalendarJson
  reminders: CalendarJson
  recurrence: string[]
  status: CalendarEventStatusValue
  source: CalendarEventSourceValue
  syncStatus: CalendarSyncStatusValue
  syncErrorCode: string | null
  localRevision: number
  attendees: CalendarEventAttendeeView[]
  createdAt: string
  updatedAt: string
}

export type CalendarRangeInput = {
  ownerUserId: string
  start: Date
  end: Date
  caseId?: string
}

export type TodayCalendarSummary = {
  timeZone: string
  start: string
  end: string
  total: number
  crmMeetings: number
  externalEvents: number
  upcoming: CalendarEventView[]
  events: CalendarEventView[]
}

export type CalendarAttendeeInput = {
  email: string
  name?: string | null
}

export type TimedCalendarSchedule = {
  allDay: false
  startsAt: Date
  endsAt: Date
  timeZone: string
}

export type AllDayCalendarSchedule = {
  allDay: true
  /** Inclusive local calendar date (YYYY-MM-DD). */
  startDate: string
  /** Exclusive local calendar date (YYYY-MM-DD), matching Google Calendar. */
  endDate: string
  timeZone?: string | null
}

export type CalendarScheduleInput = TimedCalendarSchedule | AllDayCalendarSchedule

export type CreateCalendarEventInput = {
  ownerUserId: string
  calendarId?: string
  caseId?: string | null
  title: string
  description?: string | null
  schedule: CalendarScheduleInput
  location?: string | null
  createGoogleMeet?: boolean
  attendees?: CalendarAttendeeInput[]
  recurrence?: string[]
  reminders?: CalendarJson
  sendInvites: boolean
  recurrenceScope?: CalendarRecurrenceMutationScope
}

export type UpdateCalendarEventInput = {
  ownerUserId: string
  eventId: string
  baseRevision: number
  calendarId?: string
  caseId?: string | null
  title?: string
  description?: string | null
  schedule?: CalendarScheduleInput
  location?: string | null
  createGoogleMeet?: boolean
  attendees?: CalendarAttendeeInput[]
  recurrence?: string[]
  reminders?: CalendarJson
  sendInvites: boolean
  recurrenceScope?: CalendarRecurrenceMutationScope
}

export type CancelCalendarEventInput = {
  ownerUserId: string
  eventId: string
  baseRevision: number
  sendInvites: boolean
  recurrenceScope?: CalendarRecurrenceMutationScope
}

export type AssociateCalendarEventWithCaseInput = {
  ownerUserId: string
  eventId: string
  caseId: string
}

export type SetCalendarPreferencesInput = {
  ownerUserId: string
  visibleCalendarIds: string[]
  crmDefaultCalendarId: string
  timeZone?: string
}

export type CalendarNotificationRelation = {
  recipientUserId: string
  calendarEventId: string
  caseId: string | null
  href: string
}
