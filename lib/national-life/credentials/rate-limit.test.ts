import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getRedisClient: vi.fn() }))
vi.mock('@/lib/redis/client', () => ({ getRedisClient: mocks.getRedisClient }))

import {
  consumeCredentialLeaseLimit,
  resetCredentialLeaseMemoryLimitsForTests,
} from './rate-limit'

describe('credential lease limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCredentialLeaseMemoryLimitsForTests()
  })

  it('fails closed in production when Redis is absent or unavailable', async () => {
    mocks.getRedisClient.mockReturnValue(null)
    const input = {
      agentId: 'agent_1', deviceId: 'device_1', agentMax: 3,
      agentWindowSeconds: 900, deviceMax: 5, deviceWindowSeconds: 3_600,
    }
    await expect(consumeCredentialLeaseLimit(input, { environment: 'production' }))
      .resolves.toEqual({ allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' })

    mocks.getRedisClient.mockReturnValue({ eval: vi.fn().mockRejectedValue(new Error('private redis detail')) })
    await expect(consumeCredentialLeaseLimit(input, { environment: 'production' }))
      .resolves.toEqual({ allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' })
  })

  it('uses the same bounded agent and device limits in development memory', async () => {
    mocks.getRedisClient.mockReturnValue(null)
    const base = {
      agentId: 'agent_1', agentMax: 2, agentWindowSeconds: 900,
      deviceMax: 5, deviceWindowSeconds: 3_600,
    }
    await expect(consumeCredentialLeaseLimit({ ...base, deviceId: 'device_1' }, {
      environment: 'development', now: () => 1_000,
    })).resolves.toEqual({ allowed: true })
    await expect(consumeCredentialLeaseLimit({ ...base, deviceId: 'device_2' }, {
      environment: 'development', now: () => 1_001,
    })).resolves.toEqual({ allowed: true })
    await expect(consumeCredentialLeaseLimit({ ...base, deviceId: 'device_3' }, {
      environment: 'development', now: () => 1_002,
    })).resolves.toMatchObject({ allowed: false, code: 'CREDENTIAL_RATE_LIMITED' })
  })

  it('atomically consumes both Redis limits and returns a bounded retry delay', async () => {
    const evalCommand = vi.fn().mockResolvedValue([0, 47])
    mocks.getRedisClient.mockReturnValue({ eval: evalCommand })
    const result = await consumeCredentialLeaseLimit({
      agentId: 'agent_1', deviceId: 'device_1', agentMax: 3,
      agentWindowSeconds: 900, deviceMax: 5, deviceWindowSeconds: 3_600,
    }, { environment: 'production' })

    expect(result).toEqual({
      allowed: false, code: 'CREDENTIAL_RATE_LIMITED', retryAfterSeconds: 47,
    })
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      2,
      'kbot:credential-lease:agent:agent_1',
      'kbot:credential-lease:device:device_1',
      3,
      900,
      5,
      3_600,
    )
  })
})
