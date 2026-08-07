import 'server-only'
import { getRedisClient } from './client'

/// Backing store para `secondaryStorage` do better-auth (sessão + rate limit).
/// Sem Redis configurado, cai pra `undefined` e o better-auth usa Postgres —
/// não trava o boot, só perde o offload.
export function createRedisSecondaryStorage() {
  const redis = getRedisClient()
  if (!redis) return undefined

  return {
    get: async (key: string) => redis.get(key),
    set: async (key: string, value: string, ttl?: number) => {
      if (ttl) await redis.set(key, value, 'EX', ttl)
      else await redis.set(key, value)
    },
    delete: async (key: string) => {
      await redis.del(key)
    },
  }
}
