import 'server-only'

import { getRedisClient } from '@/lib/redis/client'

export type CredentialLeaseLimitResult =
  | { allowed: true }
  | { allowed: false; code: 'CREDENTIAL_RATE_LIMITED'; retryAfterSeconds: number }
  | { allowed: false; code: 'CREDENTIAL_LIMIT_UNAVAILABLE' }

type LimitInput = Readonly<{
  agentId: string
  deviceId: string
  agentMax: number
  agentWindowSeconds: number
  deviceMax: number
  deviceWindowSeconds: number
}>

type Bucket = { count: number; resetAt: number }
const MEMORY_KEY = Symbol.for('keeprone.kbot.credentialLeaseLimits')
const identifier = /^[A-Za-z0-9._:-]{1,128}$/

function memoryBuckets(): Map<string, Bucket> {
  const scope = globalThis as typeof globalThis & { [MEMORY_KEY]?: Map<string, Bucket> }
  if (!scope[MEMORY_KEY]) scope[MEMORY_KEY] = new Map()
  return scope[MEMORY_KEY]
}

export function resetCredentialLeaseMemoryLimitsForTests() {
  memoryBuckets().clear()
}

function consumeMemoryBucket(key: string, maximum: number, windowSeconds: number, now: number) {
  const buckets = memoryBuckets()
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1_000 }
    buckets.set(key, bucket)
  }
  bucket.count += 1
  return {
    allowed: bucket.count <= maximum,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
  }
}

function consumeMemory(input: LimitInput, now: number): CredentialLeaseLimitResult {
  const agent = consumeMemoryBucket(
    `agent:${input.agentId}`,
    input.agentMax,
    input.agentWindowSeconds,
    now,
  )
  const device = consumeMemoryBucket(
    `device:${input.deviceId}`,
    input.deviceMax,
    input.deviceWindowSeconds,
    now,
  )
  if (agent.allowed && device.allowed) return { allowed: true }
  return {
    allowed: false,
    code: 'CREDENTIAL_RATE_LIMITED',
    retryAfterSeconds: Math.max(
      agent.allowed ? 0 : agent.retryAfterSeconds,
      device.allowed ? 0 : device.retryAfterSeconds,
    ),
  }
}

const ATOMIC_LIMIT_SCRIPT = `
local agentCount = redis.call('INCR', KEYS[1])
if agentCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
local deviceCount = redis.call('INCR', KEYS[2])
if deviceCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if agentCount > tonumber(ARGV[1]) or deviceCount > tonumber(ARGV[3]) then
  local agentTtl = redis.call('TTL', KEYS[1])
  local deviceTtl = redis.call('TTL', KEYS[2])
  return {0, math.max(agentTtl, deviceTtl, 1)}
end
return {1, 0}
`

function validInput(input: LimitInput) {
  return identifier.test(input.agentId) && identifier.test(input.deviceId) &&
    [input.agentMax, input.agentWindowSeconds, input.deviceMax, input.deviceWindowSeconds]
      .every((value) => Number.isInteger(value) && value > 0 && value <= 86_400)
}

export async function consumeCredentialLeaseLimit(
  input: LimitInput,
  options: { environment?: string; now?: () => number } = {},
): Promise<CredentialLeaseLimitResult> {
  if (!validInput(input)) return { allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' }
  const environment = options.environment ?? process.env.NODE_ENV
  const redis = getRedisClient()
  if (!redis) {
    if (environment === 'production') {
      return { allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' }
    }
    return consumeMemory(input, (options.now ?? Date.now)())
  }

  try {
    const raw = await redis.eval(
      ATOMIC_LIMIT_SCRIPT,
      2,
      `kbot:credential-lease:agent:${input.agentId}`,
      `kbot:credential-lease:device:${input.deviceId}`,
      input.agentMax,
      input.agentWindowSeconds,
      input.deviceMax,
      input.deviceWindowSeconds,
    )
    if (!Array.isArray(raw) || raw.length !== 2) throw new Error('INVALID_LIMIT_RESULT')
    const allowed = Number(raw[0])
    const retryAfterSeconds = Number(raw[1])
    if (allowed === 1) return { allowed: true }
    if (allowed !== 0 || !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
      throw new Error('INVALID_LIMIT_RESULT')
    }
    return {
      allowed: false,
      code: 'CREDENTIAL_RATE_LIMITED',
      retryAfterSeconds: Math.min(retryAfterSeconds, 86_400),
    }
  } catch {
    if (environment === 'production') {
      return { allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' }
    }
    return consumeMemory(input, (options.now ?? Date.now)())
  }
}
