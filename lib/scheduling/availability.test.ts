import { describe, expect, it, vi } from 'vitest'
import {
  assertPublicSchedulingSlotAvailable,
  getPublicSchedulingAvailability,
} from './availability'
import { GOOGLE_CALENDAR_OPTIONAL_SCOPES } from '@/lib/calendar/constants'

function pageRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    ownerUserId: 'owner-1',
    slug: 'maria-silva',
    enabled: true,
    title: 'Conversa inicial',
    description: 'Escolha o melhor horário.',
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 0,
    maximumAdvanceDays: 60,
    weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
    ownerUser: {
      name: 'Maria Silva',
      timeZone: 'America/New_York',
      agent: { status: 'ACTIVE' },
      calendarIntegrations: [{
        status: 'CONNECTED',
        grantedScopes: [GOOGLE_CALENDAR_OPTIONAL_SCOPES[0]],
        calendars: [{ visible: true, crmDefault: true, accessRole: 'owner' }],
      }],
    },
    ...overrides,
  }
}

function dependencies(record = pageRecord()) {
  return {
    db: {
      schedulingPage: { findUnique: vi.fn(async () => record) },
      schedulingBooking: { findMany: vi.fn(async () => []) },
    } as never,
    now: new Date('2026-08-16T12:00:00.000Z'),
    getEvents: vi.fn(async () => []),
    getFreeBusy: vi.fn(async () => ({ connected: true, intervals: [] })),
    getGoogleEnv: vi.fn(() => ({} as never)),
    confirmationEmailReady: true,
  }
}

describe('public scheduling availability', () => {
  it('generates canonical host-local slots and removes live Google conflicts', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockResolvedValueOnce({
      connected: true,
      intervals: [{
        calendarSourceId: 'calendar-1',
        providerCalendarId: 'primary',
        start: new Date('2026-08-17T13:30:00.000Z'),
        end: new Date('2026-08-17T14:00:00.000Z'),
      }],
    } as never)

    const result = await getPublicSchedulingAvailability({
      slug: 'maria-silva',
      from: '2026-08-17',
      days: 1,
      viewerTimeZone: 'America/New_York',
    }, deps)

    expect(result.page).toEqual({
      slug: 'maria-silva',
      title: 'Conversa inicial',
      description: 'Escolha o melhor horário.',
      durationMinutes: 30,
      ownerName: 'Maria Silva',
      ownerTimeZone: 'America/New_York',
    })
    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-08-17T13:00:00.000Z',
      '2026-08-17T14:00:00.000Z',
      '2026-08-17T14:30:00.000Z',
    ])
  })

  it('fails closed when live Google availability is not connected', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockResolvedValueOnce({ connected: false, intervals: [] })
    await expect(getPublicSchedulingAvailability({
      slug: 'maria-silva',
      from: '2026-08-17',
      days: 1,
      viewerTimeZone: 'America/New_York',
    }, deps)).rejects.toMatchObject({ code: 'SCHEDULING_UNAVAILABLE' })
  })

  it('fails closed when a published page loses confirmation e-mail delivery', async () => {
    const deps = dependencies()
    deps.confirmationEmailReady = false

    await expect(getPublicSchedulingAvailability({
      slug: 'maria-silva',
      from: '2026-08-17',
      days: 1,
      viewerTimeZone: 'America/New_York',
    }, deps)).rejects.toMatchObject({ code: 'SCHEDULING_UNAVAILABLE' })
    expect(deps.getFreeBusy).not.toHaveBeenCalled()
  })

  it('revalidates only the submitted buffered interval and rejects a new Google conflict', async () => {
    const record = pageRecord({ bufferBeforeMinutes: 10, bufferAfterMinutes: 15 })
    const deps = dependencies(record)
    deps.getFreeBusy.mockResolvedValueOnce({
      connected: true,
      intervals: [{
        calendarSourceId: 'calendar-1',
        providerCalendarId: 'primary',
        start: new Date('2026-08-17T13:35:00.000Z'),
        end: new Date('2026-08-17T13:40:00.000Z'),
      }],
    } as never)

    await expect(assertPublicSchedulingSlotAvailable({
      slug: 'maria-silva',
      startsAt: new Date('2026-08-17T13:00:00.000Z'),
      now: deps.now,
    }, deps)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' })
    expect(deps.getFreeBusy).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      start: new Date('2026-08-17T12:50:00.000Z'),
      end: new Date('2026-08-17T13:45:00.000Z'),
      timeZone: 'America/New_York',
    }, expect.anything())
  })

  it('fails closed when the locked slot revalidation cannot reach Google', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockRejectedValueOnce(new Error('provider timeout'))
    await expect(assertPublicSchedulingSlotAvailable({
      slug: 'maria-silva',
      startsAt: new Date('2026-08-17T13:00:00.000Z'),
      now: deps.now,
    }, deps)).rejects.toMatchObject({ code: 'SCHEDULING_UNAVAILABLE' })
  })

  it('skips nonexistent spring-forward wall-clock slots instead of shifting them', async () => {
    const record = pageRecord({
      weeklyWindows: [{ weekday: 0, startMinute: 90, endMinute: 240 }],
    })
    const deps = dependencies(record)
    deps.now = new Date('2026-03-01T12:00:00.000Z')
    const result = await getPublicSchedulingAvailability({
      slug: 'maria-silva',
      from: '2026-03-08',
      days: 1,
      viewerTimeZone: 'America/New_York',
    }, deps)
    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ])
  })
})
