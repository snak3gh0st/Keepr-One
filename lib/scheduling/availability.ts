import 'server-only'

import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  addCalendarDays,
  assertValidIanaTimeZone,
  dateKeyInTimeZone,
  parseCalendarDate,
  zonedDateTimeToUtc,
} from '@/lib/calendar/time'
import { getCalendarEventsForRange } from '@/lib/calendar/repository'
import { getGoogleCalendarEnv } from '@/lib/calendar/google/env'
import { getGoogleFreeBusyForUser } from '@/lib/calendar/google/freebusy'
import { isEmailDeliveryConfigured } from '@/lib/email/client'
import { evaluateSchedulingReadiness } from './readiness'
import { SchedulingError } from './errors'
import type { UserLanguage } from '@/lib/i18n/config'

type AvailabilityDb = Pick<PrismaClient, 'schedulingPage' | 'schedulingBooking'>

export type PublicSchedulingPage = {
  id: string
  ownerUserId: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  slotIntervalMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  minimumNoticeMinutes: number
  maximumAdvanceDays: number
  ownerName: string
  ownerLanguage: UserLanguage
  ownerTimeZone: string
  weeklyWindows: Array<{
    weekday: number
    startMinute: number
    endMinute: number
  }>
}

export type PublicSchedulingSlot = {
  startsAt: string
  endsAt: string
}

type BusyInterval = { start: Date; end: Date }

type AvailabilityDependencies = {
  db?: AvailabilityDb
  now?: Date
  getEvents?: typeof getCalendarEventsForRange
  getFreeBusy?: typeof getGoogleFreeBusyForUser
  getGoogleEnv?: typeof getGoogleCalendarEnv
  confirmationEmailReady?: boolean
}

type SlotAvailabilityInput = {
  slug: string
  startsAt: Date
  now?: Date
}

function dateParts(value: string) {
  const date = parseCalendarDate(value)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function localMidnight(value: string, timeZone: string) {
  return zonedDateTimeToUtc({ ...dateParts(value), hour: 0, minute: 0, second: 0 }, timeZone)
}

function localDateTime(value: string, minute: number, timeZone: string) {
  const normalized = minute === 1440 ? addCalendarDays(value, 1) : value
  const minuteOfDay = minute === 1440 ? 0 : minute
  return zonedDateTimeToUtc({
    ...dateParts(normalized),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    second: 0,
  }, timeZone)
}

function overlaps(start: Date, end: Date, busy: BusyInterval) {
  return start < busy.end && end > busy.start
}

export function isCanonicalSchedulingStart(
  page: Pick<
    PublicSchedulingPage,
    'ownerTimeZone' | 'durationMinutes' | 'slotIntervalMinutes' | 'weeklyWindows'
  >,
  startsAt: Date,
) {
  const localDate = dateKeyInTimeZone(startsAt, page.ownerTimeZone)
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: page.ownerTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(startsAt)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(local.find((value) => value.type === type)?.value)
  const startMinute = part('hour') * 60 + part('minute')
  if (part('second') !== 0 || startsAt.getUTCMilliseconds() !== 0) return false
  const weekday = parseCalendarDate(localDate).getUTCDay()
  return page.weeklyWindows.some((window) =>
    window.weekday === weekday &&
    startMinute >= window.startMinute &&
    startMinute + page.durationMinutes <= window.endMinute &&
    (startMinute - window.startMinute) % page.slotIntervalMinutes === 0,
  )
}

function eventBusyInterval(
  event: Awaited<ReturnType<typeof getCalendarEventsForRange>>[number],
  ownerTimeZone: string,
): BusyInterval | null {
  if (!event.allDay && event.startsAt && event.endsAt) {
    return { start: new Date(event.startsAt), end: new Date(event.endsAt) }
  }
  if (event.allDay && event.startDate && event.endDate) {
    const timeZone = event.timeZone ?? ownerTimeZone
    return {
      start: localMidnight(event.startDate, timeZone),
      end: localMidnight(event.endDate, timeZone),
    }
  }
  return null
}

async function loadBusyIntervals(
  page: PublicSchedulingPage,
  queryStart: Date,
  queryEnd: Date,
  dependencies: AvailabilityDependencies,
) {
  const db = dependencies.db ?? prisma
  let localEvents: Awaited<ReturnType<typeof getCalendarEventsForRange>>
  let googleBusy: Awaited<ReturnType<typeof getGoogleFreeBusyForUser>>
  let bookings: Array<{ blockedStartsAt: Date; blockedEndsAt: Date }>
  try {
    ;[localEvents, googleBusy, bookings] = await Promise.all([
      (dependencies.getEvents ?? getCalendarEventsForRange)({
        ownerUserId: page.ownerUserId,
        start: queryStart,
        end: queryEnd,
      }),
      (dependencies.getFreeBusy ?? getGoogleFreeBusyForUser)(
        {
          ownerUserId: page.ownerUserId,
          start: queryStart,
          end: queryEnd,
          timeZone: page.ownerTimeZone,
        },
        (dependencies.getGoogleEnv ?? getGoogleCalendarEnv)(),
      ),
      db.schedulingBooking.findMany({
        where: {
          ownerUserId: page.ownerUserId,
          status: 'CONFIRMED',
          blockedStartsAt: { lt: queryEnd },
          blockedEndsAt: { gt: queryStart },
        },
        select: { blockedStartsAt: true, blockedEndsAt: true },
      }),
    ])
  } catch (error) {
    throw new SchedulingError(
      'SCHEDULING_UNAVAILABLE',
      'Não foi possível confirmar a disponibilidade com o Google Agenda.',
      error,
    )
  }
  if (!googleBusy.connected) {
    throw new SchedulingError(
      'SCHEDULING_UNAVAILABLE',
      'A conexão do Google Agenda não está pronta para receber reservas.',
    )
  }
  return [
    ...googleBusy.intervals.map((interval) => ({ start: interval.start, end: interval.end })),
    ...localEvents.flatMap((event) => {
      const interval = eventBusyInterval(event, page.ownerTimeZone)
      return interval ? [interval] : []
    }),
    ...bookings.map((booking) => ({
      start: booking.blockedStartsAt,
      end: booking.blockedEndsAt,
    })),
  ] satisfies BusyInterval[]
}

export async function getPublicSchedulingPage(
  slug: string,
  db: AvailabilityDb = prisma,
  confirmationEmailReady = isEmailDeliveryConfigured(),
): Promise<PublicSchedulingPage> {
  const page = await db.schedulingPage.findUnique({
    where: { slug },
    select: {
      id: true,
      ownerUserId: true,
      slug: true,
      enabled: true,
      title: true,
      description: true,
      durationMinutes: true,
      slotIntervalMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      minimumNoticeMinutes: true,
      maximumAdvanceDays: true,
      weeklyWindows: {
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
        select: { weekday: true, startMinute: true, endMinute: true },
      },
      ownerUser: {
        select: {
          name: true,
          language: true,
          timeZone: true,
          agent: { select: { status: true } },
          calendarIntegrations: {
            where: { provider: 'GOOGLE' },
            take: 1,
            select: {
              status: true,
              grantedScopes: true,
              calendars: {
                select: { visible: true, crmDefault: true, accessRole: true },
              },
            },
          },
        },
      },
    },
  })
  if (!page || !page.enabled || page.ownerUser.agent?.status !== 'ACTIVE') {
    throw new SchedulingError('PAGE_NOT_FOUND', 'Esta página de agendamento não está disponível.')
  }
  assertValidIanaTimeZone(page.ownerUser.timeZone)
  const readiness = evaluateSchedulingReadiness(
    page.ownerUser.calendarIntegrations[0] ?? null,
    confirmationEmailReady,
  )
  if (!readiness.canEnable) {
    throw new SchedulingError(
      'SCHEDULING_UNAVAILABLE',
      'A agenda está temporariamente indisponível para novos horários.',
    )
  }
  return {
    id: page.id,
    ownerUserId: page.ownerUserId,
    slug: page.slug,
    title: page.title,
    description: page.description,
    durationMinutes: page.durationMinutes,
    slotIntervalMinutes: page.slotIntervalMinutes,
    bufferBeforeMinutes: page.bufferBeforeMinutes,
    bufferAfterMinutes: page.bufferAfterMinutes,
    minimumNoticeMinutes: page.minimumNoticeMinutes,
    maximumAdvanceDays: page.maximumAdvanceDays,
    ownerName: page.ownerUser.name,
    ownerLanguage: page.ownerUser.language,
    ownerTimeZone: page.ownerUser.timeZone,
    weeklyWindows: page.weeklyWindows,
  }
}

/**
 * Performs a narrow, fail-closed availability check for one submitted slot.
 * Booking creation calls this again while holding the owner's advisory lock,
 * immediately before the final local conflict check and write transaction.
 */
export async function assertPublicSchedulingSlotAvailable(
  input: SlotAvailabilityInput,
  dependencies: AvailabilityDependencies = {},
) {
  if (!Number.isFinite(input.startsAt.getTime())) {
    throw new SchedulingError('INVALID_REQUEST', 'Horário de agendamento inválido.')
  }
  const db = dependencies.db ?? prisma
  const now = input.now ?? dependencies.now ?? new Date()
  const page = await getPublicSchedulingPage(
    input.slug,
    db,
    dependencies.confirmationEmailReady ?? isEmailDeliveryConfigured(),
  )
  if (!isCanonicalSchedulingStart(page, input.startsAt)) {
    throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
  }
  const minimumStart = new Date(now.getTime() + page.minimumNoticeMinutes * 60_000)
  const maximumStart = new Date(now.getTime() + page.maximumAdvanceDays * 86_400_000)
  if (input.startsAt < minimumStart || input.startsAt > maximumStart) {
    throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
  }
  const endsAt = new Date(input.startsAt.getTime() + page.durationMinutes * 60_000)
  const blockedStart = new Date(input.startsAt.getTime() - page.bufferBeforeMinutes * 60_000)
  const blockedEnd = new Date(endsAt.getTime() + page.bufferAfterMinutes * 60_000)
  const busy = await loadBusyIntervals(page, blockedStart, blockedEnd, {
    ...dependencies,
    db,
  })
  if (busy.some((interval) => overlaps(blockedStart, blockedEnd, interval))) {
    throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
  }
}

export async function getPublicSchedulingAvailability(
  input: {
    slug: string
    from: string
    days: number
    viewerTimeZone: string
  },
  dependencies: AvailabilityDependencies = {},
) {
  assertValidIanaTimeZone(input.viewerTimeZone)
  parseCalendarDate(input.from)
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 31) {
    throw new SchedulingError('INVALID_REQUEST', 'Período de disponibilidade inválido.')
  }
  const db = dependencies.db ?? prisma
  const now = dependencies.now ?? new Date()
  const page = await getPublicSchedulingPage(
    input.slug,
    db,
    dependencies.confirmationEmailReady ?? isEmailDeliveryConfigured(),
  )
  const viewerRangeStart = localMidnight(input.from, input.viewerTimeZone)
  const viewerRangeEnd = localMidnight(addCalendarDays(input.from, input.days), input.viewerTimeZone)
  const queryStart = new Date(viewerRangeStart.getTime() - page.bufferBeforeMinutes * 60_000)
  const queryEnd = new Date(viewerRangeEnd.getTime() + page.bufferAfterMinutes * 60_000)

  const busy = await loadBusyIntervals(page, queryStart, queryEnd, {
    ...dependencies,
    db,
  })

  const minimumStart = new Date(now.getTime() + page.minimumNoticeMinutes * 60_000)
  const maximumStart = new Date(now.getTime() + page.maximumAdvanceDays * 86_400_000)
  const firstHostDate = dateKeyInTimeZone(viewerRangeStart, page.ownerTimeZone)
  const lastHostDate = dateKeyInTimeZone(new Date(viewerRangeEnd.getTime() - 1), page.ownerTimeZone)
  const slots: PublicSchedulingSlot[] = []
  const seen = new Set<string>()

  for (
    let hostDate = firstHostDate;
    hostDate <= lastHostDate;
    hostDate = addCalendarDays(hostDate, 1)
  ) {
    const weekday = parseCalendarDate(hostDate).getUTCDay()
    const windows = page.weeklyWindows.filter((window) => window.weekday === weekday)
    for (const window of windows) {
      for (
        let startMinute = window.startMinute;
        startMinute + page.durationMinutes <= window.endMinute;
        startMinute += page.slotIntervalMinutes
      ) {
        let startsAt: Date
        try {
          startsAt = localDateTime(hostDate, startMinute, page.ownerTimeZone)
        } catch {
          // Spring-forward can remove a local wall-clock slot. It must never be
          // shifted silently into another hour.
          continue
        }
        const endsAt = new Date(startsAt.getTime() + page.durationMinutes * 60_000)
        if (
          startsAt < viewerRangeStart || startsAt >= viewerRangeEnd ||
          startsAt < minimumStart || startsAt > maximumStart
        ) continue
        const blockedStart = new Date(startsAt.getTime() - page.bufferBeforeMinutes * 60_000)
        const blockedEnd = new Date(endsAt.getTime() + page.bufferAfterMinutes * 60_000)
        if (busy.some((interval) => overlaps(blockedStart, blockedEnd, interval))) continue
        const key = startsAt.toISOString()
        if (seen.has(key)) continue
        seen.add(key)
        slots.push({ startsAt: key, endsAt: endsAt.toISOString() })
      }
    }
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return {
    page: {
      slug: page.slug,
      title: page.title,
      description: page.description,
      durationMinutes: page.durationMinutes,
      ownerName: page.ownerName,
      ownerLanguage: page.ownerLanguage,
      ownerTimeZone: page.ownerTimeZone,
    },
    slots,
  }
}
