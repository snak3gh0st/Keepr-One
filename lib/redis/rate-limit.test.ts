import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
}))

vi.mock('./client', () => ({ getRedisClient: () => redisMock }))

import { consumeRateLimit } from './rate-limit'

describe('consumeRateLimit', () => {
  beforeEach(() => {
    redisMock.incr.mockReset()
    redisMock.expire.mockReset()
    redisMock.ttl.mockReset()
  })

  it('allows the request and sets an expiry on the first hit', async () => {
    redisMock.incr.mockResolvedValue(1)

    const result = await consumeRateLimit({ key: 'login:agent-1', max: 5, windowSeconds: 60 })

    expect(result).toEqual({ allowed: true })
    expect(redisMock.expire).toHaveBeenCalledWith('ratelimit:login:agent-1', 60)
  })

  it('allows the request while under the limit without resetting the expiry', async () => {
    redisMock.incr.mockResolvedValue(3)

    const result = await consumeRateLimit({ key: 'login:agent-1', max: 5, windowSeconds: 60 })

    expect(result).toEqual({ allowed: true })
    expect(redisMock.expire).not.toHaveBeenCalled()
  })

  it('denies the request once the count exceeds max, reporting retry-after from ttl', async () => {
    redisMock.incr.mockResolvedValue(6)
    redisMock.ttl.mockResolvedValue(37)

    const result = await consumeRateLimit({ key: 'login:agent-1', max: 5, windowSeconds: 60 })

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 37 })
  })

  it('falls back to the window length when ttl is unavailable', async () => {
    redisMock.incr.mockResolvedValue(6)
    redisMock.ttl.mockResolvedValue(-1)

    const result = await consumeRateLimit({ key: 'login:agent-1', max: 5, windowSeconds: 60 })

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })
})
