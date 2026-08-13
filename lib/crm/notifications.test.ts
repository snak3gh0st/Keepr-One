import { describe, expect, it, vi } from 'vitest'
import { generateDueFollowUpNotifications } from './follow-ups'

describe('follow-up notification generation', () => {
  it('uses a stable schedule-aware dedupe key and skipDuplicates', async () => {
    const scheduledAt = new Date('2026-08-11T13:00:00.000Z')
    const created: Array<Record<string, unknown>> = []
    const tx = {
      $queryRaw: async () => [{ id: 'fu-1' }],
      followUp: {
        findMany: async () => [{
          id: 'fu-1', caseId: 'case-1', scheduledAt,
          ownerAgent: { userId: 'user-1' },
          insuranceCase: { prospect: { firstName: 'João', lastName: 'Silva' } },
        }],
      },
      notification: {
        createMany: async ({ data, skipDuplicates }: { data: Array<Record<string, unknown>>; skipDuplicates: boolean }) => {
          created.push(...data)
          expect(skipDuplicates).toBe(true)
          return { count: 1 }
        },
      },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const result = await generateDueFollowUpNotifications(
      new Date('2026-08-11T16:00:00.000Z'),
      db as never,
    )

    expect(result).toEqual({ examined: 1, created: 1 })
    expect(created[0]).toMatchObject({
      recipientUserId: 'user-1', followUpId: 'fu-1', caseId: 'case-1',
      dedupeKey: 'follow-up-due:fu-1:2026-08-11T13:00:00.000Z',
      href: '/agent/cases/case-1', message: 'Faça o follow-up com João Silva.',
      title: 'Follow-up de hoje',
    })
  })

  it('does not query beyond the instant that has arrived', async () => {
    let rawQueryCalls = 0
    const tx = {
      $queryRaw: async () => { rawQueryCalls += 1; return [] },
      followUp: { findMany: async () => [] },
      notification: { createMany: async () => ({ count: 0 }) },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }
    const now = new Date('2026-08-11T16:00:00.000Z')
    expect(await generateDueFollowUpNotifications(now, db as never)).toEqual({ examined: 0, created: 0 })
    expect(rawQueryCalls).toBe(1)
  })

  it('revalidates locked candidates and never creates a stale unread notification', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }))
    const tx = {
      $queryRaw: async () => [{ id: 'fu-1' }],
      // Simulate a candidate that changed before the locked state was loaded.
      followUp: { findMany: async () => [] },
      notification: { createMany },
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(generateDueFollowUpNotifications(new Date('2026-08-11T16:00:00.000Z'), db as never))
      .resolves.toEqual({ examined: 0, created: 0 })
    expect(createMany).not.toHaveBeenCalled()
  })
})
