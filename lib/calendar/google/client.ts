import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  GOOGLE_CALENDAR_API_URL,
  GOOGLE_CALENDAR_WATCH_LIFETIME_MS,
} from './constants'
import { googleFetchJson, type GoogleFetch, withQuery } from './http'
import type {
  GoogleCalendarEvent,
  GoogleCalendarListResponse,
  GoogleColorsResponse,
  GoogleEventWrite,
  GoogleEventsListResponse,
  GoogleFreeBusyResponse,
  GoogleWatchResponse,
} from './types'

export type GoogleSendUpdates = 'all' | 'externalOnly' | 'none'

export type GoogleCalendarClientOptions = {
  accessToken: string
  fetch?: GoogleFetch
  apiBaseUrl?: string
}

export class GoogleCalendarClient {
  readonly accessToken: string
  private readonly fetchImpl: GoogleFetch
  private readonly apiBaseUrl: string

  constructor(options: GoogleCalendarClientOptions) {
    this.accessToken = options.accessToken
    this.fetchImpl = options.fetch ?? fetch
    this.apiBaseUrl = (options.apiBaseUrl ?? GOOGLE_CALENDAR_API_URL).replace(/\/$/, '')
  }

  private request<T>(path: string, init: RequestInit = {}) {
    return googleFetchJson<T>(this.fetchImpl, `${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  }

  private requestUrl<T>(url: URL, init: RequestInit = {}) {
    return googleFetchJson<T>(this.fetchImpl, url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  }

  async listCalendars() {
    const items: NonNullable<GoogleCalendarListResponse['items']> = []
    let pageToken: string | undefined
    do {
      const url = withQuery(`${this.apiBaseUrl}/users/me/calendarList`, {
        maxResults: 250,
        minAccessRole: 'reader',
        pageToken,
        showDeleted: false,
        showHidden: true,
      })
      const page = await this.requestUrl<GoogleCalendarListResponse>(url)
      items.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return items
  }

  getColors() {
    return this.request<GoogleColorsResponse>('/colors')
  }

  getEvent(calendarId: string, eventId: string) {
    return this.request<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    )
  }

  createEvent(
    calendarId: string,
    event: GoogleEventWrite,
    options: { sendUpdates?: GoogleSendUpdates; conferenceDataVersion?: 1 } = {},
  ) {
    const url = withQuery(
      `${this.apiBaseUrl}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        sendUpdates: options.sendUpdates ?? 'none',
        conferenceDataVersion: options.conferenceDataVersion,
      },
    )
    return this.requestUrl<GoogleCalendarEvent>(url, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  }

  updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleEventWrite,
    options: {
      sendUpdates?: GoogleSendUpdates
      conferenceDataVersion?: 1
      etag?: string | null
    } = {},
  ) {
    const url = withQuery(
      `${this.apiBaseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        sendUpdates: options.sendUpdates ?? 'none',
        conferenceDataVersion: options.conferenceDataVersion,
      },
    )
    return this.requestUrl<GoogleCalendarEvent>(url, {
      // PATCH preserves provider fields the CRM does not own (attachments,
      // extendedProperties, conference metadata) instead of replacing the
      // complete Google resource with our intentionally minimal projection.
      method: 'PATCH',
      headers: options.etag ? { 'If-Match': options.etag } : undefined,
      body: JSON.stringify(event),
    })
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    options: { sendUpdates?: GoogleSendUpdates } = {},
  ) {
    const url = withQuery(
      `${this.apiBaseUrl}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { sendUpdates: options.sendUpdates ?? 'none' },
    )
    await this.requestUrl<null>(url, { method: 'DELETE' })
  }

  moveEvent(
    sourceCalendarId: string,
    eventId: string,
    destinationCalendarId: string,
    options: { sendUpdates?: GoogleSendUpdates } = {},
  ) {
    const url = withQuery(
      `${this.apiBaseUrl}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move`,
      {
        destination: destinationCalendarId,
        sendUpdates: options.sendUpdates ?? 'none',
      },
    )
    return this.requestUrl<GoogleCalendarEvent>(url, { method: 'POST' })
  }

  /**
   * Lists a complete full/incremental pass. The callback receives every page,
   * while the returned sync token is exposed only after the final page.
   */
  async listEventPages(input: {
    calendarId: string
    syncToken?: string | null
    timeMin?: string
    timeMax?: string
    singleEvents?: boolean
    onPage: (items: GoogleCalendarEvent[]) => Promise<void>
  }) {
    let pageToken: string | undefined
    let nextSyncToken: string | undefined
    do {
      const url = withQuery(
        `${this.apiBaseUrl}/calendars/${encodeURIComponent(input.calendarId)}/events`,
        {
          maxResults: 2500,
          pageToken,
          showDeleted: true,
          singleEvents: input.singleEvents ?? true,
          syncToken: input.syncToken ?? undefined,
          // Google forbids range filters together with syncToken.
          timeMin: input.syncToken ? undefined : input.timeMin,
          timeMax: input.syncToken ? undefined : input.timeMax,
        },
      )
      const page = await this.requestUrl<GoogleEventsListResponse>(url)
      await input.onPage(page.items ?? [])
      pageToken = page.nextPageToken
      if (!pageToken) nextSyncToken = page.nextSyncToken
    } while (pageToken)

    if (!nextSyncToken) {
      throw new Error('Google Calendar did not return nextSyncToken on the final page')
    }
    return nextSyncToken
  }

  freeBusy(input: { timeMin: string; timeMax: string; timeZone?: string; calendarIds: string[] }) {
    if (!input.calendarIds.length || input.calendarIds.length > 50) {
      throw new Error('Google FreeBusy accepts between 1 and 50 calendars')
    }
    return this.request<GoogleFreeBusyResponse>('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timeZone,
        items: input.calendarIds.map((id) => ({ id })),
      }),
    })
  }

  watchEvents(input: {
    calendarId: string
    address: string
    channelId?: string
    token: string
    expiresAt?: Date
  }) {
    const url = withQuery(
      `${this.apiBaseUrl}/calendars/${encodeURIComponent(input.calendarId)}/events/watch`,
      { showDeleted: true, singleEvents: true },
    )
    return this.requestUrl<GoogleWatchResponse>(url, {
      method: 'POST',
      body: JSON.stringify({
        id: input.channelId ?? randomUUID(),
        type: 'web_hook',
        address: input.address,
        token: input.token,
        expiration: String(
          (input.expiresAt ?? new Date(Date.now() + GOOGLE_CALENDAR_WATCH_LIFETIME_MS)).getTime(),
        ),
      }),
    })
  }

  async stopChannel(channelId: string, resourceId: string) {
    await this.request<null>('/channels/stop', {
      method: 'POST',
      body: JSON.stringify({ id: channelId, resourceId }),
    })
  }
}
