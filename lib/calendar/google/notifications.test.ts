import { describe, expect, it, vi } from 'vitest'
import { generateDueCalendarNotifications } from './notifications'

describe('calendar meeting reminders', () => {
  it('creates one idempotent notification only for a due case-linked meeting', async () => {
    const createdKeys = new Set<string>()
    const notificationCreate = vi.fn(async ({ data }: { data: { dedupeKey: string } }) => {
      createdKeys.add(data.dedupeKey)
      return { id: 'notification' }
    })
    const tx = {
      notification: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async ({ where }: { where: { dedupeKey: string } }) =>
          createdKeys.has(where.dedupeKey) ? { id: 'notification' } : null),
        create: notificationCreate,
      },
    }
    const db = {
      calendarEvent: {
        findMany: vi.fn(async () => [{
          id: 'event', ownerUserId: 'user', insuranceCaseId: 'case', title: 'Lead meeting',
          startsAt: new Date('2026-08-12T14:15:00Z'), reminders: {
            useDefault: false, overrides: [{ method: 'popup', minutes: 15 }],
          },
        }]),
      },
      notification: {},
      $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx),
    }
    const now = new Date('2026-08-12T14:00:00Z')
    await generateDueCalendarNotifications(now, db as never)
    await generateDueCalendarNotifications(now, db as never)
    expect(notificationCreate).toHaveBeenCalledTimes(1)
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        recipientUserId: 'user', calendarEventId: 'event', caseId: 'case',
        type: 'CALENDAR_EVENT_REMINDER', href: '/agent/cases/case',
      }),
    }))
  })
})
