import { describe, expect, it, vi } from 'vitest'
import {
  cancelFollowUp,
  completeFollowUp,
  moveCaseAndScheduleFollowUp,
  rescheduleFollowUp,
  scheduleFollowUp,
} from './follow-ups'

describe('follow-up lifecycle', () => {
  it('schedules the dedicated record and its timeline entry in one transaction', async () => {
    const scheduledAt = new Date('2026-08-16T13:00:00.000Z')
    const timelineCreate = vi.fn(async () => ({ id: 'event' }))
    const linkUpdate = vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status: 'SCHEDULED', completedAt: null, cancelledAt: null }))
    const tx = {
      insuranceCase: { findFirst: vi.fn(async () => ({ id: 'case', assignedAgentId: 'agent' })) },
      user: { findUnique: vi.fn(async () => ({ agent: { id: 'agent' } })) },
      followUp: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status: 'SCHEDULED', completedAt: null, cancelledAt: null })),
        update: linkUpdate,
      },
      caseTimelineEvent: { create: timelineCreate },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(scheduleFollowUp({
      caseId: 'case', scheduledAt, title: 'Ligar para João', actorUserId: 'user', scopeAgentIds: ['agent'],
    }, db as never)).resolves.toMatchObject({ id: 'fu', status: 'SCHEDULED' })
    expect(tx.followUp.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerAgentId: 'agent', createdByUserId: 'user' }) }))
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'FOLLOW_UP_SCHEDULED' }) }))
    expect(linkUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { sourceTimelineEventId: 'event' } }))
  })

  it('rejects a second scheduled follow-up for the same lead with a clear error', async () => {
    const scheduledAt = new Date('2026-08-16T13:00:00.000Z')
    const tx = {
      insuranceCase: { findFirst: vi.fn(async () => ({ id: 'case', assignedAgentId: 'agent' })) },
      user: { findUnique: vi.fn(async () => ({ agent: { id: 'agent' } })) },
      followUp: { findFirst: vi.fn(async () => ({ id: 'existing', scheduledAt })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(scheduleFollowUp({
      caseId: 'case', scheduledAt, actorUserId: 'user', scopeAgentIds: ['agent'],
    }, db as never)).rejects.toMatchObject({
      code: 'FOLLOW_UP_ALREADY_SCHEDULED',
      message: expect.stringContaining('Reagende o atual'),
    })
  })

  it('moves to Follow-up without regressing the locked technical case stage', async () => {
    const scheduledAt = new Date('2026-08-16T13:00:00.000Z')
    const timelineCreate = vi.fn()
      .mockResolvedValueOnce({ id: 'stage-event' })
      .mockResolvedValueOnce({ id: 'follow-up-event' })
    const caseUpdate = vi.fn(async () => ({ id: 'case' }))
    const tx = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = String(query)
        return sql.includes('CrmPipeline') ? [{ id: 'pipeline' }] : [{ stage: 'UNDERWRITING', status: 'OPEN' }]
      }),
      insuranceCase: {
        findFirst: vi.fn(async () => ({
          id: 'case', assignedAgentId: 'agent',
          crmStage: { id: 'old-stage', name: 'Qualificado', systemKey: 'QUALIFIED' },
        })),
        findUnique: vi.fn(async () => ({ crmStage: { id: 'old-stage', name: 'Qualificado' } })),
        update: caseUpdate,
      },
      crmPipeline: { findUnique: vi.fn(async () => ({ id: 'pipeline' })) },
      crmStage: {
        findFirst: vi.fn(async () => ({ id: 'follow-up-stage', name: 'Follow-up', systemKey: 'FOLLOW_UP' })),
      },
      user: { findUnique: vi.fn(async () => ({ agent: { id: 'agent' } })) },
      followUp: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status: 'SCHEDULED', completedAt: null, cancelledAt: null })),
        update: vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status: 'SCHEDULED', completedAt: null, cancelledAt: null })),
      },
      caseTimelineEvent: { create: timelineCreate },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await moveCaseAndScheduleFollowUp({
      caseId: 'case', crmStageId: 'follow-up-stage', scheduledAt,
      actorUserId: 'user', scopeAgentIds: ['agent'],
    }, db as never)

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
    expect(caseUpdate).toHaveBeenCalledWith({ where: { id: 'case' }, data: { crmStageId: 'follow-up-stage' } })
    expect(caseUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ stage: 'LEAD' }) }))
  })

  it('completes idempotently, records history and clears unread reminders', async () => {
    const at = new Date('2026-08-16T14:00:00.000Z')
    const scheduledAt = new Date('2026-08-16T13:00:00.000Z')
    const timelineCreate = vi.fn(async () => ({ id: 'event' }))
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      followUp: {
        findFirst: vi.fn(async () => ({ id: 'fu', caseId: 'case', status: 'SCHEDULED', scheduledAt, sourceTimelineEventId: 'scheduled-event' })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status: 'COMPLETED', completedAt: at, cancelledAt: null })),
      },
      notification: { updateMany },
      caseTimelineEvent: { create: timelineCreate, updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(completeFollowUp({ followUpId: 'fu', actorUserId: 'user', scopeAgentIds: ['agent'], at }, db as never)).resolves.toMatchObject({ status: 'COMPLETED', completedAt: at })
    expect(updateMany).toHaveBeenCalledWith({ where: { followUpId: 'fu', readAt: null }, data: { readAt: at } })
    expect(timelineCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'FOLLOW_UP_COMPLETED', doneAt: at }) }))
    expect(tx.caseTimelineEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'scheduled-event', doneAt: null }, data: { doneAt: at },
    })
  })

  it('rescheduling closes the previous timeline reminder and links the new one', async () => {
    const previous = new Date('2026-08-16T13:00:00.000Z')
    const next = new Date('2026-08-21T13:00:00.000Z')
    const tx = {
      followUp: {
        findFirst: vi.fn(async () => ({
          id: 'fu', caseId: 'case', status: 'SCHEDULED', title: 'Ligar',
          scheduledAt: previous, sourceTimelineEventId: 'old-event',
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async ({ data }: { data: { sourceTimelineEventId: string } }) => ({
          id: 'fu', caseId: 'case', scheduledAt: next, status: 'SCHEDULED',
          completedAt: null, cancelledAt: null, ...data,
        })),
      },
      notification: { updateMany: vi.fn(async () => ({ count: 1 })) },
      caseTimelineEvent: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({ id: 'new-event' })),
      },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    await rescheduleFollowUp({
      followUpId: 'fu', scheduledAt: next, actorUserId: 'user', scopeAgentIds: ['agent'],
    }, db as never)
    expect(tx.caseTimelineEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-event', doneAt: null },
    }))
    expect(tx.followUp.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceTimelineEventId: 'new-event' }),
    }))
    expect(tx.followUp.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'SCHEDULED', scheduledAt: previous, sourceTimelineEventId: 'old-event' }),
      data: expect.objectContaining({ scheduledAt: next }),
    }))
  })

  it('validates the 160 character title limit when rescheduling', async () => {
    const tx = {
      followUp: {
        findFirst: vi.fn(async () => ({
          id: 'fu', caseId: 'case', status: 'SCHEDULED', title: 'Ligar',
          scheduledAt: new Date('2026-08-16T13:00:00.000Z'), sourceTimelineEventId: 'event',
        })),
      },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(rescheduleFollowUp({
      followUpId: 'fu', scheduledAt: new Date('2026-08-17T13:00:00.000Z'),
      title: 'x'.repeat(161), actorUserId: 'user', scopeAgentIds: ['agent'],
    }, db as never)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('allows only one concurrent reschedule to create timeline history', async () => {
    const previous = new Date('2026-08-16T13:00:00.000Z')
    let reads = 0
    let releaseReads!: () => void
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve })
    let scheduledAt = previous
    let sourceTimelineEventId = 'old-event'
    const timelineCreate = vi.fn(async () => ({ id: 'new-event' }))
    const tx = {
      followUp: {
        findFirst: vi.fn(async () => {
          reads += 1
          if (reads === 2) releaseReads()
          await bothRead
          return { id: 'fu', caseId: 'case', status: 'SCHEDULED', title: 'Ligar', scheduledAt: previous, sourceTimelineEventId: 'old-event' }
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { scheduledAt: Date; sourceTimelineEventId: string }; data: { scheduledAt: Date } }) => {
          if (scheduledAt.getTime() !== where.scheduledAt.getTime() || sourceTimelineEventId !== where.sourceTimelineEventId) return { count: 0 }
          scheduledAt = data.scheduledAt
          return { count: 1 }
        }),
        update: vi.fn(async ({ data }: { data: { sourceTimelineEventId: string } }) => {
          sourceTimelineEventId = data.sourceTimelineEventId
          return { id: 'fu', caseId: 'case', scheduledAt, status: 'SCHEDULED', completedAt: null, cancelledAt: null }
        }),
      },
      notification: { updateMany: vi.fn(async () => ({ count: 0 })) },
      caseTimelineEvent: { create: timelineCreate, updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const results = await Promise.allSettled([
      rescheduleFollowUp({ followUpId: 'fu', scheduledAt: new Date('2026-08-17T13:00:00.000Z'), actorUserId: 'u1', scopeAgentIds: ['agent'] }, db as never),
      rescheduleFollowUp({ followUpId: 'fu', scheduledAt: new Date('2026-08-18T13:00:00.000Z'), actorUserId: 'u2', scopeAgentIds: ['agent'] }, db as never),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(timelineCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps concurrent complete/cancel from overwriting the winner or duplicating history', async () => {
    const scheduledAt = new Date('2026-08-16T13:00:00.000Z')
    let reads = 0
    let releaseReads!: () => void
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve })
    let status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' = 'SCHEDULED'
    let completedAt: Date | null = null
    let cancelledAt: Date | null = null
    const timelineCreate = vi.fn(async () => ({ id: 'resolved-event' }))
    const tx = {
      followUp: {
        findFirst: vi.fn(async () => {
          reads += 1
          if (reads === 2) releaseReads()
          await bothRead
          return { id: 'fu', caseId: 'case', status: 'SCHEDULED', scheduledAt, sourceTimelineEventId: 'scheduled-event' }
        }),
        updateMany: vi.fn(async ({ data }: { data: { status: 'COMPLETED' | 'CANCELLED'; completedAt?: Date; cancelledAt?: Date } }) => {
          if (status !== 'SCHEDULED') return { count: 0 }
          status = data.status
          completedAt = data.completedAt ?? null
          cancelledAt = data.cancelledAt ?? null
          return { count: 1 }
        }),
        findUniqueOrThrow: vi.fn(async () => ({ id: 'fu', caseId: 'case', scheduledAt, status, completedAt, cancelledAt })),
      },
      notification: { updateMany: vi.fn(async () => ({ count: 1 })) },
      caseTimelineEvent: { create: timelineCreate, updateMany: vi.fn(async () => ({ count: 1 })) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const results = await Promise.allSettled([
      completeFollowUp({ followUpId: 'fu', actorUserId: 'u1', scopeAgentIds: ['agent'] }, db as never),
      cancelFollowUp({ followUpId: 'fu', actorUserId: 'u2', scopeAgentIds: ['agent'] }, db as never),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(status).not.toBe('SCHEDULED')
    expect(timelineCreate).toHaveBeenCalledTimes(1)
  })
})
