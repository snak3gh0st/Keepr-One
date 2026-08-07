import 'server-only'
import { getRedisClient } from './client'

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number }

/// Janela fixa via INCR+EXPIRE. Não é a técnica mais precisa (sliding window
/// seria), mas é atômica com uma única ida ao Redis e suficiente pra conter
/// abuso — o objetivo aqui é parar de martelar o portal da carrier, não
/// contabilizar cota ao segundo.
///
/// Sem Redis configurado, o limite é tratado como "sem teto": preferível a
/// derrubar o disparo de sync por uma dependência opcional fora do ar.
export async function consumeRateLimit(options: {
  key: string
  max: number
  windowSeconds: number
}): Promise<RateLimitResult> {
  const redis = getRedisClient()
  if (!redis) return { allowed: true }

  const fullKey = `ratelimit:${options.key}`
  const count = await redis.incr(fullKey)
  if (count === 1) await redis.expire(fullKey, options.windowSeconds)

  if (count > options.max) {
    const ttl = await redis.ttl(fullKey)
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : options.windowSeconds }
  }

  return { allowed: true }
}
