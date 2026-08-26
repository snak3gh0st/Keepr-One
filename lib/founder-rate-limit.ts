import 'server-only'

import { getRedisClient } from '@/lib/redis/client'
import {
  consumeRateLimit,
  type RateLimitResult,
} from '@/lib/redis/rate-limit'

type MemoryBucket = {
  count: number
  resetAt: number
}

const memoryBuckets = new Map<string, MemoryBucket>()

/**
 * Founder registration is internet-facing, so unlike carrier-sync throttles it
 * must not become unlimited when Redis is absent. The local/single-instance
 * fallback is intentionally in memory; production should still configure
 * Redis for a limiter shared by every container.
 */
export async function consumeFounderRegistrationRateLimit(options: {
  key: string
  max: number
  windowSeconds: number
  now?: number
}): Promise<RateLimitResult> {
  if (getRedisClient()) {
    return consumeRateLimit(options)
  }

  const now = options.now ?? Date.now()
  const existing = memoryBuckets.get(options.key)
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + options.windowSeconds * 1_000 }
    : existing

  bucket.count += 1
  memoryBuckets.set(options.key, bucket)

  if (bucket.count > options.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    }
  }

  return { allowed: true }
}
