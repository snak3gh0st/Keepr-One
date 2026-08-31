import 'server-only'

import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { dateKeyInTimeZone, dateRangeForInstants } from '@/lib/calendar/time'
import {
  createCalendarEventInTransaction,
  lockCalendarSchedulingOwner,
  type CalendarTransaction,
} from '@/lib/calendar/repository'
import {
  assertPublicSchedulingSlotAvailable,
  getPublicSchedulingAvailability,
  getPublicSchedulingPage,
  isCanonicalSchedulingStart,
} from './availability'
import { SchedulingError } from './errors'
import { createSchedulingManageToken, hashSchedulingSecret } from './tokens'
import type { PublicBookingInput } from './validation'

type BookingDb = PrismaClient

type BookingDependencies = {
  db?: BookingDb
  now?: Date
  getPage?: typeof getPublicSchedulingPage
  getAvailability?: typeof getPublicSchedulingAvailability
  createEvent?: typeof createCalendarEventInTransaction
  createManageToken?: typeof createSchedulingManageToken
  revalidateSlot?: typeof assertPublicSchedulingSlotAvailable
}

const LOCKED_REVALIDATION_TIMEOUT_MS = 4_000

type IdempotentBooking = {
  id: string
  status: 'CONFIRMED' | 'CANCELLED'
  pageId: string
  startsAt: Date
  endsAt: Date
  inviteeEmail: string
  inviteeTimeZone: string
  page: {
    slug: string
    title: string
    ownerUser: { name: string }
  }
}

function resultFromBooking(booking: IdempotentBooking, idempotent: boolean) {
  return {
    booking: {
      id: booking.id,
      status: booking.status,
      title: booking.page.title,
      ownerName: booking.page.ownerUser.name,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      inviteeTimeZone: booking.inviteeTimeZone,
    },
    idempotent,
  }
}

async function findIdempotentBooking(db: BookingDb, idempotencyKeyHash: string) {
  return db.schedulingBooking.findUnique({
    where: { idempotencyKeyHash },
    select: {
      id: true,
      status: true,
      pageId: true,
      startsAt: true,
      endsAt: true,
      inviteeEmail: true,
      inviteeTimeZone: true,
      page: {
        select: {
          slug: true,
          title: true,
          ownerUser: { select: { name: true } },
        },
      },
    },
  })
}

function assertIdempotentMatch(
  booking: IdempotentBooking,
  input: { slug: string; startsAt: Date; email: string },
) {
  if (booking.status === 'CANCELLED') {
    throw new SchedulingError('SLOT_UNAVAILABLE', 'Esta reserva já foi cancelada.')
  }
  if (
    booking.page.slug !== input.slug ||
    booking.startsAt.getTime() !== input.startsAt.getTime() ||
    booking.inviteeEmail !== input.email
  ) {
    throw new SchedulingError(
      'IDEMPOTENCY_CONFLICT',
      'Esta chave de repetição já foi usada para outra reserva.',
    )
  }
}

function eventDescription(input: PublicBookingInput) {
  return [
    'Reserva criada pelo link de agendamento Keepr One.',
    `Convidado: ${input.name}`,
    input.phone ? `Telefone: ${input.phone}` : null,
    input.notes ? `Observações: ${input.notes}` : null,
  ].filter(Boolean).join('\n')
}

function isReservationConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034' || (
      error.code === 'P2004' && String(error.meta?.database_error ?? '').includes(
        'SchedulingBooking_owner_active_range_excl',
      )
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('SchedulingBooking_owner_active_range_excl') ||
    message.includes('23P01')
}

async function createBookingTransaction(
  db: BookingDb,
  input: {
    pageId: string
    pageOwnerUserId: string
    requestSlug: string
    startsAt: Date
    guest: PublicBookingInput
    idempotencyKeyHash: string
    manageTokenHash: string
    now: Date
  },
  createEvent: typeof createCalendarEventInTransaction,
  revalidateSlot: () => Promise<void>,
) {
  return db.$transaction(async (tx) => {
    await lockCalendarSchedulingOwner(tx, input.pageOwnerUserId)

    const duplicate = await tx.schedulingBooking.findUnique({
      where: { idempotencyKeyHash: input.idempotencyKeyHash },
      select: {
        id: true,
        status: true,
        pageId: true,
        startsAt: true,
        endsAt: true,
        inviteeEmail: true,
        inviteeTimeZone: true,
        page: {
          select: {
            slug: true,
            title: true,
            ownerUser: { select: { name: true } },
          },
        },
      },
    })
    if (duplicate) {
      assertIdempotentMatch(duplicate, {
        slug: input.requestSlug,
        startsAt: input.startsAt,
        email: input.guest.email,
      })
      return resultFromBooking(duplicate, true)
    }

    // A client can submit an old slot, or this transaction can wait behind a
    // concurrent booking. Recheck Google only after the per-owner lock is ours
    // so the provider snapshot is as close as possible to the local write. The
    // bounded wait keeps a slow provider from holding the database lock for a
    // long time; timeout is fail-closed. Google has no atomic
    // FreeBusy-plus-insert primitive, so a provider-side write made after this
    // check remains the irreducible external race of the outbox architecture.
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        revalidateSlot(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new SchedulingError(
            'SCHEDULING_UNAVAILABLE',
            'Não foi possível confirmar a disponibilidade com o Google Agenda.',
          )), LOCKED_REVALIDATION_TIMEOUT_MS)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }

    const page = await tx.schedulingPage.findUnique({
      where: { id: input.pageId },
      select: {
        id: true,
        ownerUserId: true,
        slug: true,
        enabled: true,
        title: true,
        durationMinutes: true,
        slotIntervalMinutes: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
        minimumNoticeMinutes: true,
        maximumAdvanceDays: true,
        weeklyWindows: {
          select: { weekday: true, startMinute: true, endMinute: true },
        },
        ownerUser: { select: { name: true, timeZone: true, agent: { select: { status: true } } } },
      },
    })
    if (
      !page || !page.enabled || page.ownerUserId !== input.pageOwnerUserId ||
      page.slug !== input.requestSlug ||
      page.ownerUser.agent?.status !== 'ACTIVE'
    ) {
      throw new SchedulingError('PAGE_NOT_FOUND', 'Esta página de agendamento não está disponível.')
    }
    const canonicalPage = {
      ownerTimeZone: page.ownerUser.timeZone,
      durationMinutes: page.durationMinutes,
      slotIntervalMinutes: page.slotIntervalMinutes,
      weeklyWindows: page.weeklyWindows,
    }
    if (!isCanonicalSchedulingStart(canonicalPage, input.startsAt)) {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
    }
    const minimumStart = new Date(input.now.getTime() + page.minimumNoticeMinutes * 60_000)
    const maximumStart = new Date(input.now.getTime() + page.maximumAdvanceDays * 86_400_000)
    if (input.startsAt < minimumStart || input.startsAt > maximumStart) {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
    }

    const endsAt = new Date(input.startsAt.getTime() + page.durationMinutes * 60_000)
    const blockedStartsAt = new Date(
      input.startsAt.getTime() - page.bufferBeforeMinutes * 60_000,
    )
    const blockedEndsAt = new Date(endsAt.getTime() + page.bufferAfterMinutes * 60_000)
    const calendarDates = dateRangeForInstants(
      blockedStartsAt,
      blockedEndsAt,
      page.ownerUser.timeZone,
    )

    const [existingEvent, existingBooking] = await Promise.all([
      tx.calendarEvent.findFirst({
        where: {
          ownerUserId: page.ownerUserId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          OR: [
            {
              allDay: false,
              startsAt: { lt: blockedEndsAt },
              endsAt: { gt: blockedStartsAt },
            },
            {
              allDay: true,
              startDate: { lt: calendarDates.endDate },
              endDate: { gt: calendarDates.startDate },
            },
          ],
        },
        select: { id: true },
      }),
      tx.schedulingBooking.findFirst({
        where: {
          ownerUserId: page.ownerUserId,
          status: 'CONFIRMED',
          blockedStartsAt: { lt: blockedEndsAt },
          blockedEndsAt: { gt: blockedStartsAt },
        },
        select: { id: true },
      }),
    ])
    if (existingEvent || existingBooking) {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
    }

    const event = await createEvent({
      ownerUserId: page.ownerUserId,
      title: `${page.title} · ${input.guest.name}`,
      description: eventDescription(input.guest),
      schedule: {
        allDay: false,
        startsAt: input.startsAt,
        endsAt,
        timeZone: page.ownerUser.timeZone,
      },
      createGoogleMeet: true,
      attendees: [{ email: input.guest.email, name: input.guest.name }],
      reminders: null,
      sendInvites: true,
    }, tx as CalendarTransaction)

    const booking = await tx.schedulingBooking.create({
      data: {
        pageId: page.id,
        ownerUserId: page.ownerUserId,
        calendarEventId: event.id,
        inviteeName: input.guest.name,
        inviteeEmail: input.guest.email,
        inviteePhone: input.guest.phone || null,
        inviteeTimeZone: input.guest.timeZone,
        notes: input.guest.notes || null,
        startsAt: input.startsAt,
        endsAt,
        blockedStartsAt,
        blockedEndsAt,
        idempotencyKeyHash: input.idempotencyKeyHash,
        manageTokenHash: input.manageTokenHash,
      },
      select: { id: true, status: true },
    })
    await tx.schedulingEmailJob.create({
      data: {
        bookingId: booking.id,
        idempotencyKey: `scheduling-confirmation-${booking.id}-v1`,
        payloadVersion: 1,
        payload: {
          to: input.guest.email,
          inviteeName: input.guest.name,
          ownerName: page.ownerUser.name,
          title: page.title,
          startsAt: input.startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          inviteeTimeZone: input.guest.timeZone,
          generatedAt: input.now.toISOString(),
        },
      },
    })
    return {
      booking: {
        id: booking.id,
        status: booking.status,
        title: page.title,
        ownerName: page.ownerUser.name,
        startsAt: input.startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        inviteeTimeZone: input.guest.timeZone,
      },
      idempotent: false,
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: LOCKED_REVALIDATION_TIMEOUT_MS + 2_000,
  })
}

export async function createPublicSchedulingBooking(
  slug: string,
  guest: PublicBookingInput,
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.db ?? prisma
  const startsAt = new Date(guest.startsAt)
  const idempotencyKeyHash = hashSchedulingSecret(guest.idempotencyKey)
  const existing = await findIdempotentBooking(db, idempotencyKeyHash)
  if (existing) {
    assertIdempotentMatch(existing, { slug, startsAt, email: guest.email })
    return resultFromBooking(existing, true)
  }

  const page = await (dependencies.getPage ?? getPublicSchedulingPage)(slug, db)
  const now = dependencies.now ?? new Date()
  const from = dateKeyInTimeZone(startsAt, guest.timeZone)
  const availability = await (dependencies.getAvailability ?? getPublicSchedulingAvailability)({
    slug,
    from,
    days: 1,
    viewerTimeZone: guest.timeZone,
  }, { db, now })
  if (!availability.slots.some((slot) => slot.startsAt === startsAt.toISOString())) {
    throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.')
  }

  const manageToken = (dependencies.createManageToken ?? createSchedulingManageToken)()
  try {
    return await createBookingTransaction(db, {
      pageId: page.id,
      pageOwnerUserId: page.ownerUserId,
      requestSlug: slug,
      startsAt,
      guest,
      idempotencyKeyHash,
      manageTokenHash: manageToken.tokenHash,
      now,
    }, dependencies.createEvent ?? createCalendarEventInTransaction, () =>
      (dependencies.revalidateSlot ?? assertPublicSchedulingSlotAvailable)({
        slug,
        startsAt,
        now: dependencies.now ?? new Date(),
      }, { db }),
    )
  } catch (error) {
    if (error instanceof SchedulingError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const duplicate = await findIdempotentBooking(db, idempotencyKeyHash)
      if (duplicate) {
        assertIdempotentMatch(duplicate, { slug, startsAt, email: guest.email })
        return resultFromBooking(duplicate, true)
      }
    }
    if (isReservationConflict(error)) {
      throw new SchedulingError('SLOT_UNAVAILABLE', 'Este horário não está mais disponível.', error)
    }
    throw error
  }
}
