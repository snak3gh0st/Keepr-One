export type GoogleCalendarListEntry = {
  id: string
  summary?: string
  summaryOverride?: string
  description?: string
  colorId?: string
  backgroundColor?: string
  foregroundColor?: string
  primary?: boolean
  selected?: boolean
  hidden?: boolean
  deleted?: boolean
  accessRole?: string
  timeZone?: string
}
export type GoogleEventDateTime = {
  date?: string
  dateTime?: string
  timeZone?: string
}

export type GoogleEventAttendee = {
  email?: string
  displayName?: string
  responseStatus?: 'needsAction' | 'accepted' | 'declined' | 'tentative'
  self?: boolean
  organizer?: boolean
}

export type GoogleConferenceData = {
  entryPoints?: Array<{ entryPointType?: string; uri?: string; label?: string }>
  conferenceSolution?: { key?: { type?: string }; name?: string }
  conferenceId?: string
  signature?: string
  notes?: string
  createRequest?: {
    requestId: string
    conferenceSolutionKey?: { type: 'hangoutsMeet' }
    status?: { statusCode?: 'pending' | 'success' | 'failure' }
  }
}

export type GoogleEventReminders = {
  useDefault?: boolean
  overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>
}

export type GoogleCalendarEvent = {
  kind?: string
  etag?: string
  id: string
  status?: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  created?: string
  updated?: string
  summary?: string
  description?: string
  location?: string
  colorId?: string
  creator?: { email?: string; displayName?: string; self?: boolean }
  organizer?: { email?: string; displayName?: string; self?: boolean }
  start?: GoogleEventDateTime
  end?: GoogleEventDateTime
  endTimeUnspecified?: boolean
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: GoogleEventDateTime
  transparency?: string
  visibility?: string
  iCalUID?: string
  sequence?: number
  attendees?: GoogleEventAttendee[]
  hangoutLink?: string
  conferenceData?: GoogleConferenceData
  reminders?: GoogleEventReminders
}

export type GoogleEventWrite = Omit<GoogleCalendarEvent, 'id' | 'kind' | 'etag' | 'created' | 'updated'> & {
  id?: string
}

export type GoogleCalendarListResponse = {
  nextPageToken?: string
  nextSyncToken?: string
  items?: GoogleCalendarListEntry[]
}

export type GoogleEventsListResponse = {
  nextPageToken?: string
  nextSyncToken?: string
  timeZone?: string
  items?: GoogleCalendarEvent[]
}

export type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
  id_token?: string
}

export type GoogleUserInfo = {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
}

export type GoogleWatchResponse = {
  kind?: string
  id: string
  resourceId: string
  resourceUri?: string
  expiration?: string
}

export type GoogleFreeBusyResponse = {
  timeMin: string
  timeMax: string
  calendars: Record<
    string,
    { errors?: Array<{ domain?: string; reason?: string }>; busy?: Array<{ start: string; end: string }> }
  >
}

export type GoogleColorsResponse = {
  updated?: string
  calendar?: Record<string, { background?: string; foreground?: string }>
  event?: Record<string, { background?: string; foreground?: string }>
}
