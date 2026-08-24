import { describe, expect, it, vi } from 'vitest'
import { enqueueInitialGoogleCalendarSyncs } from './source-selection'

describe('Google Calendar initial source selection', () => {
  it('queues a full sync only for calendars selected by the user', async () => {
    const upsert = vi.fn(async (input) => input)
    const transaction = vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations))
    const db = { calendarSyncJob: { upsert }, $transaction: transaction }

    await expect(enqueueInitialGoogleCalendarSyncs({
      integrationId: 'integration-1',
      connectedAt: new Date('2026-08-12T15:00:00.000Z'),
      sources: [
        { id: 'primary', visible: true },
        { id: 'selected-shared', visible: true },
        { id: 'hidden-shared', visible: false },
      ],
    }, db as never)).resolves.toEqual({ queued: 2 })

    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calendarId: 'primary', operation: 'FULL_SYNC' }),
    }))
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calendarId: 'selected-shared', operation: 'FULL_SYNC' }),
    }))
    expect(upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ calendarId: 'hidden-shared' }),
    }))
  })

  it('uses the connection attempt in the idempotency key and skips empty selections', async () => {
    const upsert = vi.fn()
    const transaction = vi.fn()
    const db = { calendarSyncJob: { upsert }, $transaction: transaction }

    await expect(enqueueInitialGoogleCalendarSyncs({
      integrationId: 'integration-1',
      connectedAt: new Date('2026-08-12T15:00:00.000Z'),
      sources: [{ id: 'hidden', visible: false }],
    }, db as never)).resolves.toEqual({ queued: 0 })

    expect(upsert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
