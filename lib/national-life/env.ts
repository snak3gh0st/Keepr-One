import { Buffer } from 'node:buffer'
import { z } from 'zod'

type RawNationalLifeEnv = {
  STEEL_BASE_URL?: string
  STEEL_API_KEY?: string
  NATIONAL_LIFE_PORTAL_ORIGINS?: string
  NATIONAL_LIFE_PORTAL_LOGIN_URL?: string
  NATIONAL_LIFE_SESSION_SCOPE_ID?: string
  NATIONAL_LIFE_SESSION_KEY_VERSION?: string
  NATIONAL_LIFE_SESSION_KEYS?: string
  NATIONAL_LIFE_VIEWER_SIGNING_KEY?: string
  NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN?: string
  NATIONAL_LIFE_VIEWER_BIND_HOST?: string
  NATIONAL_LIFE_VIEWER_PORT?: string
  NATIONAL_LIFE_RUNTIME_WORKER_ID?: string
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED?: string
  NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS?: string
  BETTER_AUTH_URL?: string
}

export type NationalLifeEnv = {
  steelBaseUrl: string
  steelApiKey?: string
  portalOrigins: string[]
  portalLoginUrl: string
  sessionScopeId: string
  sessionKeyVersion: string
  sessionKeys: Record<string, string>
  viewerSigningKey: Buffer
  viewerPublicOrigin: string
  viewerBindHost: string
  viewerPort: number
  runtimeWorkerId: string
  interactiveLoginEnabled: boolean
  interactiveLoginAgentIds: ReadonlySet<string>
  appOrigin: string
}

const rawNationalLifeEnvSchema = z.object({
  STEEL_BASE_URL: z.string().trim().min(1),
  STEEL_API_KEY: z.string().trim().min(1).optional(),
  NATIONAL_LIFE_PORTAL_ORIGINS: z.string().trim().min(1),
  NATIONAL_LIFE_PORTAL_LOGIN_URL: z.string().trim().min(1),
  NATIONAL_LIFE_SESSION_SCOPE_ID: z.string().trim().min(1),
  NATIONAL_LIFE_SESSION_KEY_VERSION: z.string().trim().min(1),
  NATIONAL_LIFE_SESSION_KEYS: z.string().trim().min(1),
  NATIONAL_LIFE_VIEWER_SIGNING_KEY: z.string().trim().min(1),
  NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN: z.string().trim().min(1),
  NATIONAL_LIFE_VIEWER_BIND_HOST: z.string().trim().min(1),
  NATIONAL_LIFE_VIEWER_PORT: z.string().trim().min(1),
  NATIONAL_LIFE_RUNTIME_WORKER_ID: z.string().trim().min(1).max(200),
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED: z.string().trim().min(1),
  NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS: z.string(),
  BETTER_AUTH_URL: z.string().trim().min(1),
})

function decodeBase64Key(name: string, base64Key: string) {
  const canonical =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64Key,
    )
  const key = canonical ? Buffer.from(base64Key, 'base64') : Buffer.alloc(0)
  if (
    key.length !== 32 ||
    key.toString('base64') !== base64Key
  ) {
    throw new Error(`${name} must be a base64-encoded 32-byte key`)
  }
  return key
}

function parseSessionKeys(rawKeys: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawKeys)
  } catch {
    throw new Error('NATIONAL_LIFE_SESSION_KEYS must be valid JSON')
  }

  const keys = z
    .record(z.string().trim().min(1), z.string().trim().min(1))
    .parse(parsed)
  for (const [version, base64Key] of Object.entries(keys)) {
    decodeBase64Key(`NATIONAL_LIFE_SESSION_KEYS.${version}`, base64Key)
  }
  return keys
}

function parseHttpsOrigin(name: string, value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an HTTPS origin`)
  }
  if (
    value.includes('*') ||
    parsed.protocol !== 'https:' ||
    parsed.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error(`${name} must be an exact HTTPS origin`)
  }
  return parsed.origin
}

function parseHttpsUrl(name: string, value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an HTTPS URL`)
  }
  if (value.includes('*') || parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an HTTPS URL`)
  }
  return parsed
}

function parsePortalOrigins(rawOrigins: string) {
  const origins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (origins.length === 0) {
    throw new Error(
      'NATIONAL_LIFE_PORTAL_ORIGINS must include exact HTTPS origins',
    )
  }
  return origins.map((origin) =>
    parseHttpsOrigin('NATIONAL_LIFE_PORTAL_ORIGINS origins', origin),
  )
}

function parseViewerPort(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error('NATIONAL_LIFE_VIEWER_PORT must be an integer')
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('NATIONAL_LIFE_VIEWER_PORT must be between 1 and 65535')
  }
  return port
}

function parseBoolean(name: string, value: string) {
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be true or false`)
  }
  return value === 'true'
}

function parseAgentIds(rawIds: string) {
  const ids = rawIds
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (ids.some((id) => id === '*' || id.includes('*'))) {
    throw new Error(
      'NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS does not support wildcard access',
    )
  }
  return new Set(ids)
}

function parseBindHost(value: string) {
  if (
    value.includes('://') ||
    value.includes('/') ||
    value.includes(',') ||
    /\s/.test(value)
  ) {
    throw new Error('NATIONAL_LIFE_VIEWER_BIND_HOST is invalid')
  }
  return value
}

export function assertDistinctNationalLifeRuntimeWorkerIds(
  workerIds: readonly string[],
) {
  if (new Set(workerIds).size !== workerIds.length) {
    throw new Error(
      'NATIONAL_LIFE_RUNTIME_WORKER_ID values must be unique across concurrent runtimes',
    )
  }
}

let cachedEnv: NationalLifeEnv | undefined

export function getNationalLifeEnv(): NationalLifeEnv {
  if (cachedEnv) {
    return cachedEnv
  }

  const rawEnv: RawNationalLifeEnv = {
    STEEL_BASE_URL: process.env.STEEL_BASE_URL,
    STEEL_API_KEY: process.env.STEEL_API_KEY,
    NATIONAL_LIFE_PORTAL_ORIGINS:
      process.env.NATIONAL_LIFE_PORTAL_ORIGINS,
    NATIONAL_LIFE_PORTAL_LOGIN_URL:
      process.env.NATIONAL_LIFE_PORTAL_LOGIN_URL,
    NATIONAL_LIFE_SESSION_SCOPE_ID:
      process.env.NATIONAL_LIFE_SESSION_SCOPE_ID,
    NATIONAL_LIFE_SESSION_KEY_VERSION:
      process.env.NATIONAL_LIFE_SESSION_KEY_VERSION,
    NATIONAL_LIFE_SESSION_KEYS:
      process.env.NATIONAL_LIFE_SESSION_KEYS,
    NATIONAL_LIFE_VIEWER_SIGNING_KEY:
      process.env.NATIONAL_LIFE_VIEWER_SIGNING_KEY,
    NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN:
      process.env.NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN,
    NATIONAL_LIFE_VIEWER_BIND_HOST:
      process.env.NATIONAL_LIFE_VIEWER_BIND_HOST,
    NATIONAL_LIFE_VIEWER_PORT:
      process.env.NATIONAL_LIFE_VIEWER_PORT,
    NATIONAL_LIFE_RUNTIME_WORKER_ID:
      process.env.NATIONAL_LIFE_RUNTIME_WORKER_ID,
    NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED:
      process.env.NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED,
    NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS:
      process.env.NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  }
  const parsed = rawNationalLifeEnvSchema.parse(rawEnv)
  const steelBaseUrl = parseHttpsUrl(
    'STEEL_BASE_URL',
    parsed.STEEL_BASE_URL,
  )
  const portalOrigins = parsePortalOrigins(
    parsed.NATIONAL_LIFE_PORTAL_ORIGINS,
  )
  const portalLoginUrl = parseHttpsUrl(
    'NATIONAL_LIFE_PORTAL_LOGIN_URL',
    parsed.NATIONAL_LIFE_PORTAL_LOGIN_URL,
  )
  if (!portalOrigins.includes(portalLoginUrl.origin)) {
    throw new Error(
      'NATIONAL_LIFE_PORTAL_LOGIN_URL origin must be listed in NATIONAL_LIFE_PORTAL_ORIGINS',
    )
  }

  const sessionKeys = parseSessionKeys(
    parsed.NATIONAL_LIFE_SESSION_KEYS,
  )
  if (!(parsed.NATIONAL_LIFE_SESSION_KEY_VERSION in sessionKeys)) {
    throw new Error(
      'NATIONAL_LIFE_SESSION_KEY_VERSION must exist in NATIONAL_LIFE_SESSION_KEYS',
    )
  }

  const interactiveLoginEnabled = parseBoolean(
    'NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED',
    parsed.NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED,
  )
  const interactiveLoginAgentIds = parseAgentIds(
    parsed.NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS,
  )
  if (interactiveLoginEnabled && interactiveLoginAgentIds.size === 0) {
    throw new Error(
      'NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS must list exact agent IDs when enabled',
    )
  }

  cachedEnv = {
    steelBaseUrl: steelBaseUrl.toString().replace(/\/$/, ''),
    steelApiKey: parsed.STEEL_API_KEY,
    portalOrigins,
    portalLoginUrl: portalLoginUrl.toString(),
    sessionScopeId: parsed.NATIONAL_LIFE_SESSION_SCOPE_ID,
    sessionKeyVersion: parsed.NATIONAL_LIFE_SESSION_KEY_VERSION,
    sessionKeys,
    viewerSigningKey: decodeBase64Key(
      'NATIONAL_LIFE_VIEWER_SIGNING_KEY',
      parsed.NATIONAL_LIFE_VIEWER_SIGNING_KEY,
    ),
    viewerPublicOrigin: parseHttpsOrigin(
      'NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN',
      parsed.NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN,
    ),
    viewerBindHost: parseBindHost(
      parsed.NATIONAL_LIFE_VIEWER_BIND_HOST,
    ),
    viewerPort: parseViewerPort(parsed.NATIONAL_LIFE_VIEWER_PORT),
    runtimeWorkerId: parsed.NATIONAL_LIFE_RUNTIME_WORKER_ID,
    interactiveLoginEnabled,
    interactiveLoginAgentIds,
    appOrigin: parseHttpsOrigin('BETTER_AUTH_URL', parsed.BETTER_AUTH_URL),
  }
  return cachedEnv
}

export function isNationalLifeConfigured(): boolean {
  try {
    getNationalLifeEnv()
    return true
  } catch {
    return false
  }
}
