import 'server-only'
import { Redis } from 'ioredis'

let cached: Redis | null = null

/// `null` quando REDIS_URL não está configurado — quem chama decide se isso é
/// fatal (sessão/rate-limit em produção) ou tolerável (dev local sem Redis).
export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url) return null
  if (!cached) cached = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 })
  return cached
}
