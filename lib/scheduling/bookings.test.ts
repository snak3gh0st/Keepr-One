import { describe, expect, it, vi } from 'vitest'
import { createPublicSchedulingBooking } from './bookings'
import { SchedulingError } from './errors'

const guest = {
  startsAt: '2026-08-17T13:00:00.000Z',
  name: 'João Souza',
  email: 'joao@example.com',
  timeZone: 'America/New_York',
  phone: '+1 555 0100',
  notes: 'Primeira conversa',
  idempotencyKey: 'booking-request-123456',
  hp: '' as const,
}

const publicPage = {
  id: 'page-1',
  ownerUserId: 'owner-1',
  slug: 'maria-silva',
  title: 'Conversa inicial',
  description: null,
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

function existingBooking(status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') {
  return {
    id: 'booking-1',
    status,
    pageId: 'page-1',
    startsAt: new Date(guest.startsAt),
    endsAt: new Date('2026-08-17T13:30:00.000Z'),
    inviteeEmail: guest.email,
    inviteeTimeZone: guest.timeZone,
    page: {
      slug: 'maria-silva',
      title: 'Conversa inicial',
      ownerUser: { name: 'Maria Silva' },
    },
  }
}

describe('public scheduling bookings', () => {
  it('returns an existing confirmed reservation before availability work', async () => {
    const availability = vi.fn()
    const result = await createPublicSchedulingBooking('maria-silva', guest, {
      db: {
        schedulingBooking: { findUnique: vi.fn(async () => existingBooking()) },
      } as never,
      getAvailability: availability,
    })
    expect(result).toMatchObject({
      idempotent: true,
      booking: { id: 'booking-1', status: 'CONFIRMED' },
    })
    expect(availability).not.toHaveBeenCalled()
  })

  it('rejects reuse of a cancelled booking key instead of returning a false confirmation', async () => {
    await expect(createPublicSchedulingBooking('maria-silva', guest, {
      db: {
        schedulingBooking: { findUnique: vi.fn(async () => existingBooking('CANCELLED')) },
      } as never,
    })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' })
  })

  it('creates CalendarEvent and booking in one serializable transaction with Meet and invites', async () => {
    const operationOrder: string[] = []
    const bookingCreate = vi.fn(async () => ({ id: 'booking-new', status: 'CONFIRMED' }))
    const emailJobCreate = vi.fn(async () => ({ id: 'email-job-1' }))
    const createEvent = vi.fn(async (input: Record<string, unknown>, transaction: unknown) => {
      expect(transaction).toBe(tx)
      expect(input).toMatchObject({
        ownerUserId: 'owner-1',
        createGoogleMeet: true,
        sendInvites: true,
        attendees: [{ email: guest.email, name: guest.name }],
        schedule: {
          allDay: false,
          startsAt: new Date(guest.startsAt),
          endsAt: new Date('2026-08-17T13:30:00.000Z'),
          timeZone: 'America/New_York',
        },
      })
      return { id: 'event-1' } as never
    })
    const tx = {
      $queryRaw: vi.fn(async () => []),
      schedulingBooking: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create: bookingCreate,
      },
      schedulingPage: {
        findUnique: vi.fn(async () => {
          operationOrder.push('page')
          return {
            id: 'page-1', ownerUserId: 'owner-1', slug: 'maria-silva', enabled: true,
            title: 'Conversa inicial', durationMinutes: 30, slotIntervalMinutes: 30,
            bufferBeforeMinutes: 10, bufferAfterMinutes: 15,
            minimumNoticeMinutes: 0, maximumAdvanceDays: 60,
            weeklyWindows: publicPage.weeklyWindows,
            ownerUser: { name: 'Maria Silva', timeZone: 'America/New_York', agent: { status: 'ACTIVE' } },
          }
        }),
      },
      calendarEvent: { findFirst: vi.fn(async () => null) },
      schedulingEmailJob: { create: emailJobCreate },
    }
    const transaction = vi.fn(async (run: (value: typeof tx) => unknown) => run(tx))
    tx.$queryRaw.mockImplementationOnce(async () => {
      operationOrder.push('lock')
      return []
    })
    const db = {
      schedulingBooking: { findUnique: vi.fn(async () => null) },
      $transaction: transaction,
    }
    const availability = vi.fn(async () => ({
      page: {
        slug: 'maria-silva', title: 'Conversa inicial', description: null,
        durationMinutes: 30, ownerName: 'Maria Silva', ownerTimeZone: 'America/New_York',
      },
      slots: [{ startsAt: guest.startsAt, endsAt: '2026-08-17T13:30:00.000Z' }],
    }))

    const result = await createPublicSchedulingBooking('maria-silva', guest, {
      db: db as never,
      now: new Date('2026-08-16T12:00:00.000Z'),
      getPage: vi.fn(async () => publicPage),
      getAvailability: availability,
      revalidateSlot: vi.fn(async () => { operationOrder.push('google') }),
      createEvent: createEvent as never,
      createManageToken: () => ({ rawToken: 'unused', tokenHash: 'a'.repeat(64) }),
    })

    expect(result).toMatchObject({
      idempotent: false,
      booking: { id: 'booking-new', status: 'CONFIRMED' },
    })
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 6_000,
    })
    expect(operationOrder.slice(0, 3)).toEqual(['lock', 'google', 'page'])
    expect(bookingCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        calendarEventId: 'event-1',
        blockedStartsAt: new Date('2026-08-17T12:50:00.000Z'),
        blockedEndsAt: new Date('2026-08-17T13:45:00.000Z'),
        idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }))
    expect(emailJobCreate).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-new',
        idempotencyKey: 'scheduling-confirmation-booking-new-v1',
        payloadVersion: 1,
        payload: {
          to: guest.email,
          inviteeName: guest.name,
          ownerName: 'Maria Silva',
          title: 'Conversa inicial',
          startsAt: guest.startsAt,
          endsAt: '2026-08-17T13:30:00.000Z',
          inviteeTimeZone: guest.timeZone,
          generatedAt: '2026-08-16T12:00:00.000Z',
        },
      },
    })
  })

  it('rejects a slot that became busy on Google after the initial availability response', async () => {
    const createEvent = vi.fn()
    const revalidateSlot = vi.fn(async () => {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
    })
    const tx = {
      $queryRaw: vi.fn(async () => []),
      schedulingBooking: { findUnique: vi.fn(async () => null) },
    }
    const db = {
      schedulingBooking: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
    }

    await expect(createPublicSchedulingBooking('maria-silva', guest, {
      db: db as never,
      now: new Date('2026-08-16T12:00:00.000Z'),
      getPage: vi.fn(async () => publicPage),
      getAvailability: vi.fn(async () => ({
        page: {
          slug: 'maria-silva', title: 'Conversa inicial', description: null,
          durationMinutes: 30, ownerName: 'Maria Silva', ownerTimeZone: 'America/New_York',
        },
        slots: [{ startsAt: guest.startsAt, endsAt: '2026-08-17T13:30:00.000Z' }],
      })),
      revalidateSlot,
      createEvent: createEvent as never,
      createManageToken: () => ({ rawToken: 'unused', tokenHash: 'a'.repeat(64) }),
    })).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' })

    expect(revalidateSlot).toHaveBeenCalledTimes(1)
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('fails closed without writing when the lock-scoped Google check times out', async () => {
    vi.useFakeTimers()
    try {
      const createEvent = vi.fn()
      const tx = {
        $queryRaw: vi.fn(async () => []),
        schedulingBooking: { findUnique: vi.fn(async () => null) },
      }
      const db = {
        schedulingBooking: { findUnique: vi.fn(async () => null) },
        $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
      }
      const booking = createPublicSchedulingBooking('maria-silva', guest, {
        db: db as never,
        now: new Date('2026-08-16T12:00:00.000Z'),
        getPage: vi.fn(async () => publicPage),
        getAvailability: vi.fn(async () => ({
          page: {
            slug: 'maria-silva', title: 'Conversa inicial', description: null,
            durationMinutes: 30, ownerName: 'Maria Silva', ownerTimeZone: 'America/New_York',
          },
          slots: [{ startsAt: guest.startsAt, endsAt: '2026-08-17T13:30:00.000Z' }],
        })),
        revalidateSlot: vi.fn(() => new Promise<void>(() => undefined)),
        createEvent: createEvent as never,
        createManageToken: () => ({ rawToken: 'unused', tokenHash: 'a'.repeat(64) }),
      })
      const rejected = expect(booking).rejects.toMatchObject({ code: 'SCHEDULING_UNAVAILABLE' })

      await vi.advanceTimersByTimeAsync(4_000)
      await rejected
      expect(createEvent).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
