import type { SchedulingEmailJob } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { EmailDeliveryError } from '@/lib/email/send'
import {
  claimNextSchedulingEmailJob,
  processNextSchedulingEmailJob,
} from './email-outbox'

const now = new Date('2026-08-28T15:00:00.000Z')
const originalAvailableAt = new Date('2026-08-28T14:55:00.000Z')

const payload = {
  to: 'joao@example.com',
  inviteeName: 'João Souza',
  ownerName: 'Maria Silva',
  title: 'Conversa inicial',
  startsAt: '2026-08-29T13:00:00.000Z',
  endsAt: '2026-08-29T13:30:00.000Z',
  inviteeTimeZone: 'America/New_York',
  generatedAt: '2026-08-28T12:00:00.000Z',
}

function makeClaimedJob(
  overrides: Partial<SchedulingEmailJob> = {},
): SchedulingEmailJob {
  return {
    id: 'email-job-1',
    bookingId: 'booking-1',
    status: 'PROCESSING',
    attempts: 1,
    availableAt: originalAvailableAt,
    leaseOwner: 'worker-1',
    leaseExpiresAt: new Date('2026-08-28T15:02:00.000Z'),
    idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    payloadVersion: 1,
    payload,
    providerMessageId: null,
    lastErrorCode: null,
    sentAt: null,
    createdAt: new Date('2026-08-28T14:55:00.000Z'),
    updatedAt: new Date('2026-08-28T14:55:00.000Z'),
    ...overrides,
  }
}

function makeDb(options: {
  candidateId?: string | null
  bookingStatus?: 'CONFIRMED' | 'CANCELLED' | null
  meetingUrl?: string | null
  calendarSyncStatus?: 'PENDING' | 'SYNCED' | 'ERROR'
  calendarJobStatus?: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'DEAD_LETTER' | null
  claimedJob?: SchedulingEmailJob
} = {}) {
  const candidateId = options.candidateId === undefined ? 'email-job-1' : options.candidateId
  const claimedJob = options.claimedJob ?? makeClaimedJob()
  const queryRaw = vi.fn(async () => candidateId ? [{ id: candidateId }] : [])
  const claimUpdate = vi.fn(async () => claimedJob)
  const finalizeUpdate = vi.fn(async () => ({ count: 1 }))
  const bookingFindUnique = vi.fn(async () => {
    const status = options.bookingStatus === undefined ? 'CONFIRMED' : options.bookingStatus
    return status ? {
      status,
      calendarEvent: {
        meetingUrl: options.meetingUrl === undefined
          ? 'https://meet.google.com/abc-defg-hij'
          : options.meetingUrl,
        syncStatus: options.calendarSyncStatus ?? 'SYNCED',
        syncJobs: options.calendarJobStatus === null
          ? []
          : [{ status: options.calendarJobStatus ?? 'SUCCEEDED' }],
      },
    } : null
  })
  const transaction = vi.fn(async (run: (tx: unknown) => unknown) => run({
    $queryRaw: queryRaw,
    schedulingEmailJob: { update: claimUpdate },
  }))
  const db = {
    $transaction: transaction,
    schedulingEmailJob: { updateMany: finalizeUpdate },
    schedulingBooking: { findUnique: bookingFindUnique },
  }

  return {
    db: db as never,
    queryRaw,
    claimUpdate,
    finalizeUpdate,
    bookingFindUnique,
    transaction,
  }
}

describe('scheduling confirmation email outbox', () => {
  it('returns null without trying to claim when no due job exists', async () => {
    const mocks = makeDb({ candidateId: null })

    await expect(claimNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
    })).resolves.toBeNull()

    expect(mocks.queryRaw).toHaveBeenCalledOnce()
    expect(mocks.claimUpdate).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledOnce()
  })

  it('delivers the immutable snapshot and persists the provider message id', async () => {
    const mocks = makeDb()
    const deliver = vi.fn(async () => ({ providerMessageId: 'resend-message-123' }))

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'SUCCEEDED' })

    expect(deliver).toHaveBeenCalledWith({
      bookingId: 'booking-1',
      to: 'joao@example.com',
      inviteeName: 'João Souza',
      ownerName: 'Maria Silva',
      title: 'Conversa inicial',
      startsAt: new Date('2026-08-29T13:00:00.000Z'),
      endsAt: new Date('2026-08-29T13:30:00.000Z'),
      generatedAt: new Date('2026-08-28T12:00:00.000Z'),
      inviteeTimeZone: 'America/New_York',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      calendarSyncFailed: false,
      idempotencyKey: 'scheduling-confirmation-booking-1-v1',
    })
    expect(mocks.finalizeUpdate).toHaveBeenCalledWith({
      where: {
        id: 'email-job-1',
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
      },
      data: {
        status: 'SUCCEEDED',
        providerMessageId: 'resend-message-123',
        sentAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    })
  })

  it('defers delivery without consuming an attempt while Google is still syncing', async () => {
    const mocks = makeDb({
      calendarSyncStatus: 'PENDING',
      calendarJobStatus: 'PENDING',
    })
    const deliver = vi.fn()

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'DEFERRED' })

    expect(deliver).not.toHaveBeenCalled()
    expect(mocks.finalizeUpdate).toHaveBeenCalledWith({
      where: {
        id: 'email-job-1',
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
      },
      data: {
        status: 'PENDING',
        attempts: { decrement: 1 },
        availableAt: new Date('2026-08-28T15:00:15.000Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'CALENDAR_SYNC_PENDING',
      },
    })
  })

  it('sends a manual-calendar fallback after a terminal Google failure', async () => {
    const mocks = makeDb({
      meetingUrl: null,
      calendarSyncStatus: 'ERROR',
      calendarJobStatus: 'DEAD_LETTER',
    })
    const deliver = vi.fn(async () => ({ providerMessageId: 'resend-message-123' }))

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'SUCCEEDED' })

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: null,
      calendarSyncFailed: true,
    }))
  })

  it('sends fallback when an update dead-letters after the create succeeded', async () => {
    const mocks = makeDb({
      meetingUrl: null,
      calendarSyncStatus: 'ERROR',
      // The query orders all outbound operations newest-first, so this models the
      // UPDATE_EVENT failure that followed an earlier successful CREATE_EVENT.
      calendarJobStatus: 'DEAD_LETTER',
    })
    const deliver = vi.fn(async () => ({ providerMessageId: 'resend-message-123' }))

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'SUCCEEDED' })

    expect(mocks.bookingFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        calendarEvent: {
          select: expect.objectContaining({
            syncJobs: expect.objectContaining({
              where: {
                direction: 'OUTBOUND',
                operation: { in: ['CREATE_EVENT', 'UPDATE_EVENT', 'DELETE_EVENT'] },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            }),
          }),
        },
      }),
    }))
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: null,
      calendarSyncFailed: true,
    }))
  })

  it('requeues a transient provider error with deterministic backoff', async () => {
    const mocks = makeDb()
    const error = new EmailDeliveryError('rate_limit_exceeded', true)
    const deliver = vi.fn(async () => { throw error })

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).rejects.toBe(error)

    expect(mocks.finalizeUpdate).toHaveBeenCalledWith({
      where: {
        id: 'email-job-1',
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
      },
      data: {
        status: 'PENDING',
        availableAt: new Date('2026-08-28T15:00:10.919Z'),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'rate_limit_exceeded',
      },
    })
  })

  it('moves a permanent provider rejection directly to dead letter', async () => {
    const mocks = makeDb()
    const error = new EmailDeliveryError('validation_error', false)
    const deliver = vi.fn(async () => { throw error })

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).rejects.toBe(error)

    expect(mocks.finalizeUpdate).toHaveBeenCalledWith({
      where: {
        id: 'email-job-1',
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
      },
      data: {
        status: 'DEAD_LETTER',
        availableAt: originalAvailableAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'validation_error',
      },
    })
  })

  it('dead-letters a corrupted snapshot without calling Resend', async () => {
    const mocks = makeDb({
      claimedJob: makeClaimedJob({
        payload: { ...payload, inviteeTimeZone: 'Not/AZone' },
      }),
    })
    const deliver = vi.fn()

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).rejects.toThrow('Scheduling email snapshot is invalid')

    expect(deliver).not.toHaveBeenCalled()
    expect(mocks.finalizeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'DEAD_LETTER',
        lastErrorCode: 'InvalidSchedulingEmailPayloadError',
      }),
    }))
  })

  it('cancels the email job without delivery when the booking was cancelled', async () => {
    const mocks = makeDb({ bookingStatus: 'CANCELLED' })
    const deliver = vi.fn()

    await expect(processNextSchedulingEmailJob({
      db: mocks.db,
      workerId: 'worker-1',
      now,
      deliver,
    })).resolves.toEqual({ jobId: 'email-job-1', status: 'CANCELLED' })

    expect(deliver).not.toHaveBeenCalled()
    expect(mocks.finalizeUpdate).toHaveBeenCalledWith({
      where: {
        id: 'email-job-1',
        status: 'PROCESSING',
        leaseOwner: 'worker-1',
      },
      data: {
        status: 'CANCELLED',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: 'BOOKING_CANCELLED',
      },
    })
  })
})
