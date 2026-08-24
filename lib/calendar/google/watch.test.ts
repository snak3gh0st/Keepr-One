import { describe, expect, it, vi } from 'vitest'
import { hashGoogleSecret } from './crypto'
import { acceptGoogleWebhook } from './watch'

function createDb() {
  const channel = {
    id: 'channel-db', integrationId: 'integration', calendarId: 'calendar',
    providerChannelId: 'channel-provider', resourceId: 'resource',
    channelTokenHash: hashGoogleSecret('secret-token'),
    expiresAt: new Date('2026-08-13T00:00:00Z'), status: 'ACTIVE',
    lastMessageNumber: null, lastReceivedAt: null,
  }
  const update = vi.fn(async () => channel)
  const upsert = vi.fn(async () => ({}))
  const tx = {
    calendarWatchChannel: { findUnique: vi.fn(async () => channel), update },
    calendarSyncJob: { upsert },
  }
  return { db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) }, tx, update, upsert }
}

describe('Google webhook validation', () => {
  it('rejects a forged channel token without enqueuing', async () => {
    const { db, upsert } = createDb()
    const result = await acceptGoogleWebhook({
      channelId: 'channel-provider', resourceId: 'resource', resourceState: 'exists',
      messageNumber: '9', channelToken: 'forged', channelExpiration: null,
    }, { now: new Date('2026-08-12T00:00:00Z'), db: db as never })
    expect(result).toBeNull()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('accepts one valid wake-up and enqueues an incremental sync', async () => {
    const { db, upsert } = createDb()
    const result = await acceptGoogleWebhook({
      channelId: 'channel-provider', resourceId: 'resource', resourceState: 'exists',
      messageNumber: '9', channelToken: 'secret-token', channelExpiration: null,
    }, { now: new Date('2026-08-12T00:00:00Z'), db: db as never })
    expect(result).toMatchObject({ accepted: true, duplicate: false })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ operation: 'INCREMENTAL_SYNC', direction: 'INBOUND' }),
    }))
  })
})
