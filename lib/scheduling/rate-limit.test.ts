import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/redis/client', () => ({ getRedisClient: () => null }))

import { consumeSchedulingRateLimit, schedulingRequestFingerprints } from './rate-limit'

describe('public scheduling rate limit', () => {
  it('keeps a bounded per-process fallback without Redis', async () => {
    const key = `test-${crypto.randomUUID()}`
    await expect(consumeSchedulingRateLimit({ key, max: 1, windowSeconds: 60, now: 1_000 }))
      .resolves.toEqual({ allowed: true })
    await expect(consumeSchedulingRateLimit({ key, max: 1, windowSeconds: 60, now: 1_001 }))
      .resolves.toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('keeps the email bucket stable when the requester changes IP', () => {
    const first = schedulingRequestFingerprints(new Headers({ 'x-real-ip': '192.0.2.10' }), {
      pageSlug: 'maria-silva', email: 'joao@example.com',
    })
    const second = schedulingRequestFingerprints(new Headers({ 'x-real-ip': '192.0.2.11' }), {
      pageSlug: 'maria-silva', email: 'joao@example.com',
    })
    expect(first.address).not.toBe(second.address)
    expect(first.email).toBe(second.email)
  })
})
