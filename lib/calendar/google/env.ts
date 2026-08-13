import 'server-only'

import { Buffer } from 'node:buffer'
import { z } from 'zod'

const MIN_SECRET_LENGTH = 32
const DEFAULT_WORKER_INTERVAL_SECONDS = 15
const DEFAULT_RECONCILE_INTERVAL_SECONDS = 300

type RawGoogleCalendarEnv = Partial<Record<
  | 'GOOGLE_CALENDAR_CLIENT_ID'
  | 'GOOGLE_CALENDAR_CLIENT_SECRET'
  | 'GOOGLE_CALENDAR_REDIRECT_URI'
  | 'GOOGLE_CALENDAR_WEBHOOK_URL'
  | 'GOOGLE_CALENDAR_TOKEN_KEY_VERSION'
  | 'GOOGLE_CALENDAR_TOKEN_KEYS'
  | 'GOOGLE_CALENDAR_WORKER_ID'
  | 'GOOGLE_CALENDAR_CRON_SECRET'
  | 'GOOGLE_CALENDAR_WORKER_INTERVAL_SECONDS'
  | 'GOOGLE_CALENDAR_RECONCILE_INTERVAL_SECONDS'
  | 'GOOGLE_CALENDAR_SCHEDULER_DISABLED',
  string | undefined
>>

export type GoogleCalendarEnv = {
  clientId: string
  clientSecret: string
  redirectUri: string
  webhookUrl: string
  tokenKeyVersion: string
  tokenKeys: Record<string, string>
  workerId: string
  cronSecret?: string
  workerIntervalSeconds: number
  reconcileIntervalSeconds: number
  schedulerDisabled: boolean
}

const requiredNames = [
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_CALENDAR_REDIRECT_URI',
  'GOOGLE_CALENDAR_WEBHOOK_URL',
  'GOOGLE_CALENDAR_TOKEN_KEY_VERSION',
  'GOOGLE_CALENDAR_TOKEN_KEYS',
] as const

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const value = raw?.trim()
  if (!value) return fallback
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

function parseBoolean(name: string, raw: string | undefined, fallback = false) {
  const value = raw?.trim()
  if (!value) return fallback
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false`)
  }
  return value === 'true'
}

function decodeKey(name: string, encoded: string) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`)
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`)
  }
  return decoded
}

function parseKeys(raw: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GOOGLE_CALENDAR_TOKEN_KEYS must be valid JSON')
  }
  const keys = z.record(z.string().trim().min(1), z.string().trim().min(1)).parse(parsed)
  for (const [version, encoded] of Object.entries(keys)) {
    decodeKey(`GOOGLE_CALENDAR_TOKEN_KEYS.${version}`, encoded)
  }
  return keys
}

function parseUrl(name: string, raw: string, options: { webhook?: boolean } = {}) {
  let value: URL
  try {
    value = new URL(raw)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  const localHttp =
    value.protocol === 'http:' &&
    (value.hostname === 'localhost' || value.hostname === '127.0.0.1')
  if (value.username || value.password || value.hash || (value.protocol !== 'https:' && !localHttp)) {
    throw new Error(`${name} must be HTTPS (localhost HTTP is allowed)`)
  }
  if (options.webhook && value.protocol !== 'https:') {
    throw new Error(`${name} must be an HTTPS URL reachable by Google`)
  }
  return value.toString()
}

export function isGoogleCalendarConfigured(
  raw: RawGoogleCalendarEnv = process.env as RawGoogleCalendarEnv,
) {
  return requiredNames.every((name) => Boolean(raw[name]?.trim()))
}

export function getGoogleCalendarEnv(
  raw: RawGoogleCalendarEnv = process.env as RawGoogleCalendarEnv,
): GoogleCalendarEnv {
  const missing = requiredNames.filter((name) => !raw[name]?.trim())
  if (missing.length) {
    throw new Error(`Google Calendar is not configured: missing ${missing.join(', ')}`)
  }

  const keys = parseKeys(raw.GOOGLE_CALENDAR_TOKEN_KEYS!)
  const tokenKeyVersion = raw.GOOGLE_CALENDAR_TOKEN_KEY_VERSION!.trim()
  if (!keys[tokenKeyVersion]) {
    throw new Error('GOOGLE_CALENDAR_TOKEN_KEY_VERSION must exist in GOOGLE_CALENDAR_TOKEN_KEYS')
  }

  const cronSecret = raw.GOOGLE_CALENDAR_CRON_SECRET?.trim()
  if (cronSecret && cronSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`GOOGLE_CALENDAR_CRON_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`)
  }

  return {
    clientId: raw.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
    clientSecret: raw.GOOGLE_CALENDAR_CLIENT_SECRET!.trim(),
    redirectUri: parseUrl('GOOGLE_CALENDAR_REDIRECT_URI', raw.GOOGLE_CALENDAR_REDIRECT_URI!.trim()),
    webhookUrl: parseUrl('GOOGLE_CALENDAR_WEBHOOK_URL', raw.GOOGLE_CALENDAR_WEBHOOK_URL!.trim(), { webhook: true }),
    tokenKeyVersion,
    tokenKeys: keys,
    workerId:
      raw.GOOGLE_CALENDAR_WORKER_ID?.trim() ||
      `calendar-${process.env.HOSTNAME?.trim() || process.pid}`,
    cronSecret: cronSecret || undefined,
    workerIntervalSeconds: parsePositiveInteger(
      'GOOGLE_CALENDAR_WORKER_INTERVAL_SECONDS',
      raw.GOOGLE_CALENDAR_WORKER_INTERVAL_SECONDS,
      DEFAULT_WORKER_INTERVAL_SECONDS,
      5,
      3600,
    ),
    reconcileIntervalSeconds: parsePositiveInteger(
      'GOOGLE_CALENDAR_RECONCILE_INTERVAL_SECONDS',
      raw.GOOGLE_CALENDAR_RECONCILE_INTERVAL_SECONDS,
      DEFAULT_RECONCILE_INTERVAL_SECONDS,
      60,
      86_400,
    ),
    schedulerDisabled: parseBoolean(
      'GOOGLE_CALENDAR_SCHEDULER_DISABLED',
      raw.GOOGLE_CALENDAR_SCHEDULER_DISABLED,
    ),
  }
}

export function getGoogleCalendarTokenKey(env: GoogleCalendarEnv, version = env.tokenKeyVersion) {
  const encoded = env.tokenKeys[version]
  if (!encoded) throw new Error(`Google Calendar encryption key ${version} is unavailable`)
  return decodeKey(`GOOGLE_CALENDAR_TOKEN_KEYS.${version}`, encoded)
}
