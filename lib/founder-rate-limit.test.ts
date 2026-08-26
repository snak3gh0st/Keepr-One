import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  consumeRateLimit: vi.fn(),
}))

vi.mock('@/lib/redis/client', () => ({ getRedisClient: mocks.getRedisClient }))
vi.mock('@/lib/redis/rate-limit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))

import { consumeFounderRegistrationRateLimit } from './founder-rate-limit'

describe('founder registration rate limit', () => {
  it('enforces a fixed-window memory fallback without Redis', async () => {
    mocks.getRedisClient.mockReturnValue(null)
    const input = { key: 'founder-test-memory', max: 2, windowSeconds: 60, now: 1_000 }

    await expect(consumeFounderRegistrationRateLimit(input)).resolves.toEqual({ allowed: true })
    await expect(consumeFounderRegistrationRateLimit(input)).resolves.toEqual({ allowed: true })
    await expect(consumeFounderRegistrationRateLimit(input)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    })
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled()
  })

  it('delegates to the shared Redis limiter when configured', async () => {
    mocks.getRedisClient.mockReturnValue({})
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })

    await expect(consumeFounderRegistrationRateLimit({
      key: 'founder-test-redis',
      max: 2,
      windowSeconds: 60,
    })).resolves.toEqual({ allowed: false, retryAfterSeconds: 30 })
  })
})
