import { describe, expect, it } from 'vitest'
import {
  publicBookingInputSchema,
  schedulingPageInputSchema,
} from './validation'

const page = {
  slug: 'maria-silva',
  enabled: true,
  title: 'Conversa inicial',
  description: null,
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 120,
  maximumAdvanceDays: 60,
  weeklyWindows: [
    { weekday: 1, startMinute: 540, endMinute: 720 },
  ],
}

describe('scheduling validation', () => {
  it('accepts normalized settings and rejects overlapping weekly windows', () => {
    expect(schedulingPageInputSchema.safeParse(page).success).toBe(true)
    expect(schedulingPageInputSchema.safeParse({
      ...page,
      weeklyWindows: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 600, endMinute: 780 },
      ],
    }).success).toBe(false)
  })

  it('strictly rejects unknown booking fields, invalid timezones and non-empty honeypots', () => {
    const booking = {
      startsAt: '2026-08-17T13:00:00.000Z',
      name: 'João Souza',
      email: 'JOAO@example.com',
      timeZone: 'America/New_York',
      idempotencyKey: 'booking-request-123456',
      hp: '',
    }
    const parsed = publicBookingInputSchema.safeParse(booking)
    expect(parsed.success && parsed.data.email).toBe('joao@example.com')
    expect(publicBookingInputSchema.safeParse({ ...booking, ownerUserId: 'attacker' }).success).toBe(false)
    expect(publicBookingInputSchema.safeParse({ ...booking, timeZone: 'Not/AZone' }).success).toBe(false)
    expect(publicBookingInputSchema.safeParse({ ...booking, hp: 'bot' }).success).toBe(false)
  })
})
