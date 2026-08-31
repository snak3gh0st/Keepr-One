import 'server-only'

import { createHash } from 'node:crypto'
import { getRedisClient } from '@/lib/redis/client'
import { consumeRateLimit, type RateLimitResult } from '@/lib/redis/rate-limit'

type MemoryBucket = { count: number; resetAt: number }
const MEMORY_KEY = Symbol.for('keeprOne.scheduling.rateLimitBuckets')
const globalBuckets = globalThis as typeof globalThis & {
  [MEMORY_KEY]?: Map<string, MemoryBucket>
}

function buckets() {
  globalBuckets[MEMORY_KEY] ??= new Map()
  return globalBuckets[MEMORY_KEY]
}

/**
 * Public scheduling never becomes unlimited merely because Redis is absent.
 * The memory fallback is per process; production should still configure Redis
 * so every instance shares the same counters.
 */
export async function consumeSchedulingRateLimit(options: {
  key: string
  max: number
  windowSeconds: number
  now?: number
}): Promise<RateLimitResult> {
  if (getRedisClient()) {
    try {
      return await consumeRateLimit(options)
    } catch {
      // A transient Redis failure must degrade to a bounded local limiter, not
      // an unbounded public endpoint.
    }
  }

  const now = options.now ?? Date.now()
  const store = buckets()
  const current = store.get(options.key)
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowSeconds * 1_000 }
    : current
  bucket.count += 1
  store.set(options.key, bucket)

  if (bucket.count > options.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    }
  }
  return { allowed: true }
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export function schedulingRequestFingerprints(headers: Headers, input?: {
  pageSlug?: string
  email?: string
}) {
  const forwardedFor = headers.get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const address = headers.get('x-real-ip')
    || (forwardedFor && forwardedFor[forwardedFor.length - 1])
    || 'unknown'
  const scope = input?.pageSlug?.trim().toLowerCase() || 'unknown-page'
  const email = input?.email?.trim().toLowerCase()
  return {
    address: digest(`${scope}:${address}`),
    addressAndEmail: email ? digest(`${scope}:${address}:${email}`) : null,
    email: email ? digest(`${scope}:${email}`) : null,
  }
}
