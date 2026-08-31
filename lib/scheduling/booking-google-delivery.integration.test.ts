import type { CalendarSyncJob, SchedulingEmailJob } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providers = vi.hoisted(() => ({
  getGoogleAccessToken: vi.fn(),
  resendSend: vi.fn(),
}))

vi.mock('@/lib/calendar/google/credentials', () => ({
  getGoogleAccessToken: providers.getGoogleAccessToken,
}))

vi.mock('@/lib/email/client', () => ({
  EMAIL_FROM: 'Keepr One <noreply@keeprone.com>',
  getResendClient: () => ({ emails: { send: providers.resendSend } }),
  isEmailDeliveryConfigured: () => true,
}))

import { googleEventIdForLocalEvent } from '@/lib/calendar/google/idempotency'
import { processNextGoogleCalendarJob } from '@/lib/calendar/google/outbox'
import { createPublicSchedulingBooking } from './bookings'
import { processNextSchedulingEmailJob } from './email-outbox'

const now = new Date('2026-08-16T12:00:00.000Z')
const startsAt = new Date('2026-08-17T13:00:00.000Z')
const endsAt = new Date('2026-08-17T13:30:00.000Z')

const guest = {
  startsAt: startsAt.toISOString(),
  name: 'Joao Souza',
  email: 'joao@example.com',
  timeZone: 'America/New_York',
  phone: '+1 555 0100',
  notes: 'Primeira conversa',
  idempotencyKey: 'booking-request-integration-123456',
  hp: '' as const,
}

const publicPage = {
  id: 'page-1',
  ownerUserId: 'owner-1',
  slug: 'maria-silva',
  title: 'Conversa inicial',
  description: 'Uma conversa para conhecer o cliente.',
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 15,
  minimumNoticeMinutes: 0,
  maximumAdvanceDays: 60,
  ownerName: 'Maria Silva',
  ownerTimeZone: 'America/New_York',
  weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
}

const googleEnv = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://app.example.com/google/callback',
  webhookUrl: 'https://app.example.com/google/webhook',
  tokenKeyVersion: 'v1',
  tokenKeys: { v1: Buffer.alloc(32, 7).toString('base64') },
  workerId: 'calendar-worker-integration',
  workerIntervalSeconds: 15,
  reconcileIntervalSeconds: 300,
  schedulerDisabled: true,
}

type StoredEvent = {
  id: string
  ownerUserId: string
  integrationId: string
  calendarId: string
  insuranceCaseId: string | null
  providerEventId: string | null
  providerRecurringEventId: string | null
  providerOriginalStartAt: Date | null
  providerOriginalStartDate: Date | null
  recurrence: string[]
  iCalUid: string | null
  etag: string | null
  sequence: number | null
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date
  startDate: Date | null
  endDate: Date | null
  timeZone: string
  allDay: false
  location: string | null
  meetingUrl: string | null
  conferenceData: unknown
  reminders: unknown
  colorId: string | null
  visibility: string | null
  transparency: string | null
  status: 'CONFIRMED'
  source: 'CRM'
  syncStatus: 'PENDING' | 'SYNCED' | 'ERROR'
  syncErrorCode: string | null
  providerUpdatedAt: Date | null
  deletedAt: Date | null
  lastSyncedAt: Date | null
  localRevision: number
  createdAt: Date
  updatedAt: Date
  calendar: {
    id: string
    providerCalendarId: string
    name: string
    backgroundColor: string | null
    foregroundColor: string | null
  }
  attendees: Array<{
    id: string
    email: string
    name: string | null
    responseStatus: 'NEEDS_ACTION'
    isSelf: false
    isOrganizer: false
  }>
}

type StoredBooking = {
  id: string
  status: 'CONFIRMED'
  pageId: string
  ownerUserId: string
  calendarEventId: string
  startsAt: Date
  endsAt: Date
  blockedStartsAt: Date
  blockedEndsAt: Date
  inviteeName: string
  inviteeEmail: string
  inviteePhone: string | null
  inviteeTimeZone: string
  notes: string | null
  idempotencyKeyHash: string
  manageTokenHash: string
  page: {
    slug: string
    title: string
    ownerUser: { name: string }
  }
}

function queryText(query: unknown) {
  if (query && typeof query === 'object' && 'strings' in query) {
    return Array.from((query as { strings: readonly string[] }).strings).join(' ')
  }
  return String(query)
}

function createMemoryDatabase() {
  const state: {
    event: StoredEvent | null
    syncJob: CalendarSyncJob | null
    booking: StoredBooking | null
    emailJob: SchedulingEmailJob | null
  } = {
    event: null,
    syncJob: null,
    booking: null,
    emailJob: null,
  }

  const calendar = {
    id: 'calendar-source-1',
    integrationId: 'integration-1',
    providerCalendarId: 'primary@example.com',
    accessRole: 'owner',
    integration: { userId: 'owner-1', status: 'CONNECTED' },
  }

  const tx = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query)
      if (sql.includes('"CalendarSyncJob"')) {
        return state.syncJob?.status === 'PENDING' ? [{ id: state.syncJob.id }] : []
      }
      if (sql.includes('"SchedulingEmailJob"')) {
        return state.emailJob?.status === 'PENDING' ? [{ id: state.emailJob.id }] : []
      }
      return []
    }),
    calendarSource: {
      findFirst: vi.fn(async () => calendar),
    },
    calendarEvent: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => state.event),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const data = args.data as {
          ownerUserId: string
          integrationId: string
          calendarId: string
          insuranceCaseId: string | null
          title: string
          description: string | null
          startsAt: Date
          endsAt: Date
          timeZone: string
          location: string | null
          conferenceData: unknown
          recurrence: string[]
          reminders: unknown
          source: 'CRM'
          syncStatus: 'PENDING'
          attendees: { create: Array<{ email: string; name: string | null }> }
        }
        state.event = {
          id: 'event-1',
          ownerUserId: data.ownerUserId,
          integrationId: data.integrationId,
          calendarId: data.calendarId,
          insuranceCaseId: data.insuranceCaseId,
          providerEventId: null,
          providerRecurringEventId: null,
          providerOriginalStartAt: null,
          providerOriginalStartDate: null,
          recurrence: data.recurrence,
          iCalUid: null,
          etag: null,
          sequence: null,
          title: data.title,
          description: data.description,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          startDate: null,
          endDate: null,
          timeZone: data.timeZone,
          allDay: false,
          location: data.location,
          meetingUrl: null,
          conferenceData: data.conferenceData,
          reminders: data.reminders,
          colorId: null,
          visibility: null,
          transparency: null,
          status: 'CONFIRMED',
          source: data.source,
          syncStatus: data.syncStatus,
          syncErrorCode: null,
          providerUpdatedAt: null,
          deletedAt: null,
          lastSyncedAt: null,
          localRevision: 1,
          createdAt: now,
          updatedAt: now,
          calendar: {
            id: calendar.id,
            providerCalendarId: calendar.providerCalendarId,
            name: 'Primary',
            backgroundColor: null,
            foregroundColor: null,
          },
          attendees: data.attendees.create.map((attendee, index) => ({
            id: `attendee-${index + 1}`,
            email: attendee.email,
            name: attendee.name,
            responseStatus: 'NEEDS_ACTION',
            isSelf: false,
            isOrganizer: false,
          })),
        }
        return state.event
      }),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const event = state.event
        if (!event || (args.where.id && args.where.id !== event.id)) return { count: 0 }
        if (args.where.localRevision && args.where.localRevision !== event.localRevision) return { count: 0 }
        if (args.where.providerEventId === null && event.providerEventId !== null) return { count: 0 }
        Object.assign(event, args.data)
        return { count: 1 }
      }),
    },
    calendarSyncJob: {
      create: vi.fn(async (args: { data: Omit<CalendarSyncJob, 'id' | 'status' | 'attempts' | 'availableAt' | 'leaseOwner' | 'leaseExpiresAt' | 'lastErrorCode' | 'createdAt' | 'updatedAt'> }) => {
        state.syncJob = {
          id: 'calendar-job-1',
          ...args.data,
          status: 'PENDING',
          attempts: 0,
          availableAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        }
        return { id: state.syncJob.id }
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (!state.syncJob) throw new Error('Calendar job missing')
        const attempts = args.data.attempts as { increment?: number } | undefined
        state.syncJob.attempts += attempts?.increment ?? 0
        Object.assign(state.syncJob, { ...args.data, attempts: state.syncJob.attempts })
        return state.syncJob
      }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (!state.syncJob) return { count: 0 }
        Object.assign(state.syncJob, args.data)
        return { count: 1 }
      }),
    },
    schedulingPage: {
      findUnique: vi.fn(async () => ({
        id: publicPage.id,
        ownerUserId: publicPage.ownerUserId,
        slug: publicPage.slug,
        enabled: true,
        title: publicPage.title,
        durationMinutes: publicPage.durationMinutes,
        slotIntervalMinutes: publicPage.slotIntervalMinutes,
        bufferBeforeMinutes: publicPage.bufferBeforeMinutes,
        bufferAfterMinutes: publicPage.bufferAfterMinutes,
        minimumNoticeMinutes: publicPage.minimumNoticeMinutes,
        maximumAdvanceDays: publicPage.maximumAdvanceDays,
        weeklyWindows: publicPage.weeklyWindows,
        ownerUser: {
          name: publicPage.ownerName,
          timeZone: publicPage.ownerTimeZone,
          agent: { status: 'ACTIVE' },
        },
      })),
    },
    schedulingBooking: {
      findUnique: vi.fn(async () => state.booking ? {
        ...state.booking,
        calendarEvent: state.event ? {
          meetingUrl: state.event.meetingUrl,
          syncStatus: state.event.syncStatus,
          syncJobs: state.syncJob ? [{ status: state.syncJob.status }] : [],
        } : null,
      } : null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Omit<StoredBooking, 'id' | 'status' | 'page'> }) => {
        state.booking = {
          id: 'booking-1',
          status: 'CONFIRMED',
          ...args.data,
          page: {
            slug: publicPage.slug,
            title: publicPage.title,
            ownerUser: { name: publicPage.ownerName },
          },
        }
        return { id: state.booking.id, status: state.booking.status }
      }),
    },
    schedulingEmailJob: {
      create: vi.fn(async (args: { data: Pick<SchedulingEmailJob, 'bookingId' | 'idempotencyKey' | 'payloadVersion' | 'payload'> }) => {
        state.emailJob = {
          id: 'email-job-1',
          ...args.data,
          status: 'PENDING',
          attempts: 0,
          availableAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          providerMessageId: null,
          lastErrorCode: null,
          sentAt: null,
          createdAt: now,
          updatedAt: now,
        }
        return { id: state.emailJob.id }
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (!state.emailJob) throw new Error('Email job missing')
        const attempts = args.data.attempts as { increment?: number } | undefined
        state.emailJob.attempts += attempts?.increment ?? 0
        Object.assign(state.emailJob, { ...args.data, attempts: state.emailJob.attempts })
        return state.emailJob
      }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (!state.emailJob) return { count: 0 }
        Object.assign(state.emailJob, args.data)
        return { count: 1 }
      }),
    },
  }

  const db = {
    ...tx,
    $transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
  }

  return { db, state }
}

describe('public booking to Google and confirmation delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providers.getGoogleAccessToken.mockResolvedValue('access-token')
    providers.resendSend.mockResolvedValue({
      data: { id: 'resend-message-1' },
      error: null,
    })
  })

  it('persists the booking/outboxes, inserts one Google Meet event and sends an ICS confirmation', async () => {
    const { db, state } = createMemoryDatabase()
    const expectedGoogleEventId = googleEventIdForLocalEvent('event-1')
    const meetingUrl = 'https://meet.google.com/abc-defg-hij'
    const googleFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return new Response(JSON.stringify({
        id: expectedGoogleEventId,
        etag: 'etag-google-1',
        iCalUID: 'google-event@google.com',
        sequence: 0,
        updated: '2026-08-16T12:00:05.000Z',
        hangoutLink: meetingUrl,
        conferenceData: {
          entryPoints: [{ entryPointType: 'video', uri: meetingUrl }],
        },
      }))
    })

    const bookingResult = await createPublicSchedulingBooking(publicPage.slug, guest, {
      db: db as never,
      now,
      getPage: vi.fn(async () => publicPage),
      getAvailability: vi.fn(async () => ({
        page: {
          slug: publicPage.slug,
          title: publicPage.title,
          description: publicPage.description,
          durationMinutes: publicPage.durationMinutes,
          ownerName: publicPage.ownerName,
          ownerTimeZone: publicPage.ownerTimeZone,
        },
        slots: [{ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }],
      })),
      // Live FreeBusy has its own integration coverage. This test keeps the
      // second, lock-scoped check explicit while focusing on the durable write
      // pipeline that begins after the provider confirms the slot is free.
      revalidateSlot: vi.fn(async () => undefined),
      createManageToken: () => ({ rawToken: 'unused', tokenHash: 'a'.repeat(64) }),
    })

    expect(bookingResult).toMatchObject({
      idempotent: false,
      booking: { id: 'booking-1', status: 'CONFIRMED' },
    })
    expect(state.booking).toMatchObject({
      calendarEventId: 'event-1',
      inviteeEmail: guest.email,
    })
    expect(state.event).toMatchObject({
      syncStatus: 'PENDING',
      conferenceData: { createMeetRequested: true },
      attendees: [{ email: guest.email, name: guest.name }],
    })
    expect(state.syncJob).toMatchObject({
      operation: 'CREATE_EVENT',
      status: 'PENDING',
      sendInvites: true,
    })
    expect(state.emailJob).toMatchObject({
      bookingId: 'booking-1',
      status: 'PENDING',
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })

    await expect(processNextGoogleCalendarJob(googleEnv, {
      db: db as never,
      fetch: googleFetch as typeof fetch,
      now,
      workerId: googleEnv.workerId,
    })).resolves.toEqual({ jobId: 'calendar-job-1', status: 'SUCCEEDED' })

    expect(googleFetch).toHaveBeenCalledOnce()
    const [googleUrlValue, googleRequest] = googleFetch.mock.calls[0]
    const googleUrl = new URL(String(googleUrlValue))
    const googlePayload = JSON.parse(String(googleRequest?.body))
    expect(googleUrl.pathname).toContain('/calendars/primary%40example.com/events')
    expect(googleUrl.searchParams.get('sendUpdates')).toBe('all')
    expect(googleUrl.searchParams.get('conferenceDataVersion')).toBe('1')
    expect(googlePayload).toMatchObject({
      id: expectedGoogleEventId,
      summary: `${publicPage.title} · ${guest.name}`,
      attendees: [{ email: guest.email, displayName: guest.name }],
      start: { dateTime: startsAt.toISOString(), timeZone: publicPage.ownerTimeZone },
      end: { dateTime: endsAt.toISOString(), timeZone: publicPage.ownerTimeZone },
      conferenceData: {
        createRequest: { conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    })
    expect(state.event).toMatchObject({
      providerEventId: expectedGoogleEventId,
      meetingUrl,
      syncStatus: 'SYNCED',
      syncErrorCode: null,
    })
    expect(state.syncJob).toMatchObject({ status: 'SUCCEEDED', attempts: 1 })

    await expect(processNextSchedulingEmailJob({
      db: db as never,
      now,
      workerId: 'email-worker-integration',
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'SUCCEEDED' })

    expect(providers.resendSend).toHaveBeenCalledOnce()
    const [emailPayload, emailRequest] = providers.resendSend.mock.calls[0] as [
      {
        to: string
        subject: string
        html: string
        attachments: Array<{ filename: string; content: string; contentType: string }>
      },
      { idempotencyKey: string },
    ]
    expect(emailPayload).toMatchObject({
      to: guest.email,
      subject: `Agendamento confirmado: ${publicPage.title}`,
    })
    expect(emailPayload.html).toContain(meetingUrl)
    expect(emailRequest).toEqual({
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })
    expect(emailPayload.attachments).toHaveLength(1)
    expect(emailPayload.attachments[0]).toMatchObject({
      filename: 'conversa-inicial.ics',
      contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
    })
    const ics = Buffer.from(emailPayload.attachments[0].content, 'base64').toString('utf8')
    expect(ics).toContain('BEGIN:VCALENDAR\r\n')
    expect(ics).toContain('BEGIN:VEVENT\r\n')
    expect(ics).toContain('DTSTART:20260817T130000Z\r\n')
    expect(ics).toContain('DTEND:20260817T133000Z\r\n')
    expect(ics).toContain('SUMMARY:Conversa inicial\r\n')
    expect(ics).toContain(`URL:${meetingUrl}\r\n`)
    expect(ics).toContain('STATUS:CONFIRMED\r\n')
    expect(state.emailJob).toMatchObject({
      status: 'SUCCEEDED',
      attempts: 1,
      providerMessageId: 'resend-message-1',
    })
  })
})
