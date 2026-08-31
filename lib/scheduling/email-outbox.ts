import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  Prisma,
  type PrismaClient,
  type SchedulingEmailJob,
} from '@prisma/client'
import { z } from 'zod'
import { isValidIanaTimeZone } from '@/lib/calendar/time'
import { EmailDeliveryError, sendSchedulingConfirmationEmail } from '@/lib/email/send'
import { prisma } from '@/lib/prisma'
import {
  SCHEDULING_EMAIL_JOB_LEASE_MS,
  SCHEDULING_EMAIL_MAX_JOB_ATTEMPTS,
} from './constants'

type EmailOutboxDb = Pick<
  PrismaClient,
  'schedulingEmailJob' | 'schedulingBooking' | '$transaction'
>

type ClaimedEmailJob = SchedulingEmailJob

type EmailOutboxDependencies = {
  db?: EmailOutboxDb
  now?: Date
  workerId?: string
  deliver?: typeof sendSchedulingConfirmationEmail
}

const CALENDAR_SYNC_WAIT_MS = 15_000

const instantSchema = z.string().max(64).refine(
  (value) => Number.isFinite(new Date(value).getTime()),
  'Invalid email snapshot instant',
)

const confirmationPayloadSchema = z.strictObject({
  to: z.string().email().max(254),
  inviteeName: z.string().min(1).max(100),
  ownerName: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  startsAt: instantSchema,
  endsAt: instantSchema,
  inviteeTimeZone: z.string().min(1).max(100).refine(isValidIanaTimeZone),
  generatedAt: instantSchema,
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
  message: 'The email snapshot must end after it starts',
})

class InvalidSchedulingEmailPayloadError extends Error {
  constructor() {
    super('Scheduling email snapshot is invalid')
    this.name = 'InvalidSchedulingEmailPayloadError'
  }
}

function backoff(attempts: number, now: Date) {
  const cappedSeconds = Math.min(30 * 60, 2 ** Math.min(attempts, 10) * 5)
  const deterministicJitter = (attempts * 7919) % 1000
  return new Date(now.getTime() + cappedSeconds * 1000 + deterministicJitter)
}

function errorCode(error: unknown) {
  if (error instanceof EmailDeliveryError) return error.code.slice(0, 120)
  if (error instanceof Error) return error.name.slice(0, 120)
  return 'UNKNOWN_ERROR'
}

export async function claimNextSchedulingEmailJob(
  input: { workerId: string; now?: Date; db?: EmailOutboxDb },
): Promise<ClaimedEmailJob | null> {
  const db = input.db ?? prisma
  const now = input.now ?? new Date()
  const leaseExpiresAt = new Date(now.getTime() + SCHEDULING_EMAIL_JOB_LEASE_MS)
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "SchedulingEmailJob"
      WHERE (
        ("status" = 'PENDING' AND "availableAt" <= ${now})
        OR
        ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${now})
      )
      ORDER BY "availableAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `)
    const candidate = rows[0]
    if (!candidate) return null
    return tx.schedulingEmailJob.update({
      where: { id: candidate.id },
      data: {
        status: 'PROCESSING',
        leaseOwner: input.workerId,
        leaseExpiresAt,
        attempts: { increment: 1 },
      },
    })
  })
}

async function cancelUndeliverableJob(
  db: EmailOutboxDb,
  job: ClaimedEmailJob,
  workerId: string,
) {
  await db.schedulingEmailJob.updateMany({
    where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
    data: {
      status: 'CANCELLED',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: 'BOOKING_CANCELLED',
    },
  })
  return { jobId: job.id, status: 'CANCELLED' as const }
}

async function deferUntilCalendarSync(
  db: EmailOutboxDb,
  job: ClaimedEmailJob,
  workerId: string,
  now: Date,
) {
  await db.schedulingEmailJob.updateMany({
    where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
    data: {
      status: 'PENDING',
      attempts: { decrement: 1 },
      availableAt: new Date(now.getTime() + CALENDAR_SYNC_WAIT_MS),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: 'CALENDAR_SYNC_PENDING',
    },
  })
  return { jobId: job.id, status: 'DEFERRED' as const }
}

export async function processNextSchedulingEmailJob(
  dependencies: EmailOutboxDependencies = {},
) {
  const db = dependencies.db ?? prisma
  const now = dependencies.now ?? new Date()
  const workerId = dependencies.workerId ?? `scheduling-email-${randomUUID()}`
  const job = await claimNextSchedulingEmailJob({ workerId, now, db })
  if (!job) return null

  const booking = await db.schedulingBooking.findUnique({
    where: { id: job.bookingId },
    select: {
      status: true,
      calendarEvent: {
        select: {
          syncStatus: true,
          meetingUrl: true,
          syncJobs: {
            where: {
              direction: 'OUTBOUND',
              operation: { in: ['CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  })
  if (!booking || booking.status === 'CANCELLED') {
    return cancelUndeliverableJob(db, job, workerId)
  }

  const calendarEvent = booking.calendarEvent
  const latestOutboundJob = calendarEvent?.syncJobs[0]
  const calendarSyncFailed = !calendarEvent || latestOutboundJob?.status === 'DEAD_LETTER'
  if (calendarEvent?.syncStatus !== 'SYNCED' && !calendarSyncFailed) {
    return deferUntilCalendarSync(db, job, workerId, now)
  }

  try {
    if (job.payloadVersion !== 1) throw new InvalidSchedulingEmailPayloadError()
    const parsed = confirmationPayloadSchema.safeParse(job.payload)
    if (!parsed.success) throw new InvalidSchedulingEmailPayloadError()
    const payload = parsed.data
    const result = await (dependencies.deliver ?? sendSchedulingConfirmationEmail)({
      bookingId: job.bookingId,
      to: payload.to,
      inviteeName: payload.inviteeName,
      ownerName: payload.ownerName,
      title: payload.title,
      startsAt: new Date(payload.startsAt),
      endsAt: new Date(payload.endsAt),
      generatedAt: new Date(payload.generatedAt),
      inviteeTimeZone: payload.inviteeTimeZone,
      meetingUrl: calendarEvent?.meetingUrl ?? null,
      calendarSyncFailed,
      idempotencyKey: job.idempotencyKey,
    })
    await db.schedulingEmailJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
      data: {
        status: 'SUCCEEDED',
        providerMessageId: result.providerMessageId,
        sentAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    })
    return { jobId: job.id, status: 'SUCCEEDED' as const }
  } catch (error) {
    const retryable = error instanceof InvalidSchedulingEmailPayloadError
      ? false
      : error instanceof EmailDeliveryError
        ? error.retryable
        : true
    const dead = !retryable || job.attempts >= SCHEDULING_EMAIL_MAX_JOB_ATTEMPTS
    await db.schedulingEmailJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseOwner: workerId },
      data: {
        status: dead ? 'DEAD_LETTER' : 'PENDING',
        availableAt: dead ? job.availableAt : backoff(job.attempts, now),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode(error),
      },
    })
    throw error
  }
}

export async function drainSchedulingEmailOutbox(
  options: EmailOutboxDependencies & { limit?: number } = {},
) {
  const limit = options.limit ?? 25
  let processed = 0
  for (; processed < limit; processed += 1) {
    const result = await processNextSchedulingEmailJob(options)
    if (!result) break
  }
  return { processed }
}
