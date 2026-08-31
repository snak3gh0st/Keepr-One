import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  booking: vi.fn(),
  after: vi.fn(),
  captureException: vi.fn(),
  emailConfigured: vi.fn(),
  emailDrain: vi.fn(),
  googleConfigured: vi.fn(),
  googleDrain: vi.fn(),
  googleEnv: vi.fn(),
  rateLimit: vi.fn(),
  sameOrigin: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/calendar/google/env', () => ({
  getGoogleCalendarEnv: mocks.googleEnv,
  isGoogleCalendarConfigured: mocks.googleConfigured,
}))
vi.mock('@/lib/calendar/google/outbox', () => ({
  drainGoogleCalendarOutbox: mocks.googleDrain,
}))
vi.mock('@/lib/email/client', () => ({
  isEmailDeliveryConfigured: mocks.emailConfigured,
}))
vi.mock('@/lib/scheduling/email-outbox', () => ({
  drainSchedulingEmailOutbox: mocks.emailDrain,
}))

vi.mock('@/lib/scheduling', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scheduling')>()
  return {
    ...actual,
    getPublicSchedulingAvailability: mocks.availability,
    createPublicSchedulingBooking: mocks.booking,
    consumeSchedulingRateLimit: mocks.rateLimit,
  }
})
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.sameOrigin,
}))

import { SchedulingError } from '@/lib/scheduling'
import { GET } from './slots/route'
import { POST } from './bookings/route'

const context = { params: Promise.resolve({ slug: 'maria-silva' }) }
const validBooking = {
  startsAt: '2026-08-17T13:00:00.000Z',
  name: 'João Souza',
  email: 'JOAO@example.com',
  timeZone: 'America/New_York',
  idempotencyKey: 'booking-request-123456',
  hp: '',
}

describe('public scheduling routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.after.mockImplementation(() => undefined)
    mocks.emailConfigured.mockReturnValue(false)
    mocks.emailDrain.mockResolvedValue(undefined)
    mocks.googleConfigured.mockReturnValue(false)
    mocks.googleDrain.mockResolvedValue(undefined)
    mocks.googleEnv.mockReturnValue({ source: 'test-google-calendar-env' })
    mocks.rateLimit.mockResolvedValue({ allowed: true })
    mocks.availability.mockResolvedValue({
      page: {
        slug: 'maria-silva', title: 'Conversa inicial', description: null,
        durationMinutes: 30, ownerName: 'Maria Silva', ownerTimeZone: 'America/New_York',
      },
      slots: [{ startsAt: '2026-08-17T13:00:00.000Z', endsAt: '2026-08-17T13:30:00.000Z' }],
    })
    mocks.booking.mockResolvedValue({
      booking: {
        id: 'booking-1', status: 'CONFIRMED', title: 'Conversa inicial',
        ownerName: 'Maria Silva', startsAt: '2026-08-17T13:00:00.000Z',
        endsAt: '2026-08-17T13:30:00.000Z', inviteeTimeZone: 'America/New_York',
      },
      idempotent: false,
    })
  })

  it('returns only public page data and UTC slots with no-store semantics', async () => {
    const response = await GET(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/slots?from=2026-08-17&days=7&timeZone=America%2FNew_York',
      { headers: { 'x-real-ip': '192.0.2.1' } },
    ), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      page: expect.not.objectContaining({ email: expect.anything() }),
      slots: [{ startsAt: '2026-08-17T13:00:00.000Z', endsAt: '2026-08-17T13:30:00.000Z' }],
    }))
  })

  it('normalizes a strict booking payload and returns 201 for a new reservation', async () => {
    const response = await POST(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/bookings',
      {
        method: 'POST',
        headers: {
          origin: 'https://app.keeprone.com',
          host: 'app.keeprone.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify(validBooking),
      },
    ), context)
    expect(response.status).toBe(201)
    expect(mocks.booking).toHaveBeenCalledWith('maria-silva', expect.objectContaining({
      email: 'joao@example.com',
    }))
    expect(mocks.after).toHaveBeenCalledOnce()
  })

  it('drains Google and confirmation email jobs independently after the response', async () => {
    const googleFailure = new Error('Google Calendar unavailable')
    mocks.googleConfigured.mockReturnValue(true)
    mocks.emailConfigured.mockReturnValue(true)
    mocks.googleDrain.mockRejectedValueOnce(googleFailure)

    const response = await POST(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/bookings',
      {
        method: 'POST',
        headers: {
          origin: 'https://app.keeprone.com',
          host: 'app.keeprone.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify(validBooking),
      },
    ), context)
    const afterWork = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined

    expect(response.status).toBe(201)
    expect(afterWork).toBeTypeOf('function')
    await expect(afterWork?.()).resolves.toBeUndefined()
    expect(mocks.googleDrain).toHaveBeenCalledWith(
      { source: 'test-google-calendar-env' },
      { limit: 10 },
    )
    expect(mocks.emailDrain).toHaveBeenCalledWith({ limit: 10 })
    expect(mocks.captureException).toHaveBeenCalledWith(googleFailure)
  })

  it('keeps a confirmed booking at 201 when immediate Resend delivery fails', async () => {
    const resendFailure = new Error('Resend unavailable')
    mocks.googleConfigured.mockReturnValue(true)
    mocks.emailConfigured.mockReturnValue(true)
    mocks.emailDrain.mockRejectedValueOnce(resendFailure)

    const response = await POST(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/bookings',
      {
        method: 'POST',
        headers: {
          origin: 'https://app.keeprone.com',
          host: 'app.keeprone.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify(validBooking),
      },
    ), context)
    const afterWork = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      booking: expect.objectContaining({ id: 'booking-1' }),
    }))
    await expect(afterWork?.()).resolves.toBeUndefined()
    expect(mocks.googleDrain).toHaveBeenCalledOnce()
    expect(mocks.emailDrain).toHaveBeenCalledWith({ limit: 10 })
    expect(mocks.captureException).toHaveBeenCalledWith(resendFailure)
  })

  it('rejects unknown public booking fields before rate limit or mutation', async () => {
    const response = await POST(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/bookings',
      {
        method: 'POST',
        headers: { origin: 'https://app.keeprone.com', host: 'app.keeprone.com' },
        body: JSON.stringify({ ...validBooking, ownerUserId: 'attacker' }),
      },
    ), context)
    expect(response.status).toBe(400)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.booking).not.toHaveBeenCalled()
  })

  it('maps stale slots to a public 409 without leaking internals', async () => {
    mocks.booking.mockRejectedValueOnce(new SchedulingError(
      'SLOT_UNAVAILABLE',
      'Este horário não está mais disponível.',
    ))
    const response = await POST(new Request(
      'https://app.keeprone.com/api/public/scheduling/maria-silva/bookings',
      {
        method: 'POST',
        headers: { origin: 'https://app.keeprone.com', host: 'app.keeprone.com' },
        body: JSON.stringify(validBooking),
      },
    ), context)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'SLOT_UNAVAILABLE',
      message: 'Este horário não está mais disponível.',
    })
  })
})
