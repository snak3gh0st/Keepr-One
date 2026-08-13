import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type NotificationDb = Pick<PrismaClient, 'calendarEvent' | 'notification' | '$transaction'>

function reminderMinutes(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 15
  const overrides = (value as Record<string, unknown>).overrides
  if (!Array.isArray(overrides)) return 15
  const minutes = overrides.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const value = (item as Record<string, unknown>).minutes
    return Number.isInteger(value) && Number(value) >= 0 ? [Number(value)] : []
  })
  return minutes.length ? Math.min(...minutes) : 15
}
/**
 * Generates CRM reminders only for lead-linked meetings. Google already owns
 * reminders for personal/external events, so mirroring those into the bell
 * would create noise and duplicate the user's native Calendar notification.
 */
export async function generateDueCalendarNotifications(
  now = new Date(),
  db: NotificationDb = prisma,
) {
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000)
  const events = await db.calendarEvent.findMany({
    where: {
      insuranceCaseId: { not: null },
      allDay: false,
      startsAt: { gt: now, lte: horizon },
      status: { not: 'CANCELLED' },
      deletedAt: null,
      integration: { status: 'CONNECTED' },
    },
    select: {
      id: true,
      ownerUserId: true,
      insuranceCaseId: true,
      title: true,
      startsAt: true,
      reminders: true,
    },
  })
  let created = 0
  for (const event of events) {
    if (!event.startsAt || !event.insuranceCaseId) continue
    const minutes = reminderMinutes(event.reminders)
    const dueAt = new Date(event.startsAt.getTime() - minutes * 60_000)
    if (dueAt > now) continue
    const key = `calendar:reminder:${event.id}:${event.startsAt.toISOString()}:${minutes}`
    await db.$transaction(async (tx) => {
      await tx.notification.updateMany({
        where: {
          calendarEventId: event.id,
          recipientUserId: event.ownerUserId,
          type: 'CALENDAR_EVENT_REMINDER',
          dedupeKey: { not: key },
          readAt: null,
        },
        data: { readAt: now },
      })
      const existing = await tx.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } })
      if (existing) return
      await tx.notification.create({
        data: {
          recipientUserId: event.ownerUserId,
          calendarEventId: event.id,
          caseId: event.insuranceCaseId,
          type: 'CALENDAR_EVENT_REMINDER',
          title: 'Reunião em breve',
          message: `${event.title} começa em ${minutes} minutos.`,
          href: `/agent/cases/${event.insuranceCaseId}`,
          dedupeKey: key,
        },
      })
      created += 1
    })
  }
  return { scanned: events.length, created }
}
