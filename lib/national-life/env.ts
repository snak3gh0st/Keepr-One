import { Buffer } from 'node:buffer'
import { z } from 'zod'
import {
  NATIONAL_LIFE_DEFAULT_BROWSER_PROVIDER,
  NATIONAL_LIFE_DEFAULT_BROWSER_SHARD_ID,
  NATIONAL_LIFE_DEFAULT_RECONNECT_BASE_DELAY_MS,
  NATIONAL_LIFE_DEFAULT_RECONNECT_MAX_DELAY_MS,
} from './constants'

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
  NATIONAL_LIFE_VIEWER_APP_ORIGINS?: string
  NATIONAL_LIFE_VIEWER_BIND_HOST?: string
  NATIONAL_LIFE_VIEWER_PORT?: string
  NATIONAL_LIFE_RUNTIME_WORKER_ID?: string
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED?: string
  NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS?: string
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS?: string
  NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP?: string
  NATIONAL_LIFE_BROWSER_PROVIDER?: string
  NATIONAL_LIFE_BROWSER_SHARD_ID?: string
  NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS?: string
  NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD?: string
  NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS?: string
  NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS?: string
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
  viewerAppOrigins: string[]
  viewerBindHost: string
  viewerPort: number
  runtimeWorkerId: string
  interactiveLoginEnabled: boolean
  interactiveLoginAgentIds: ReadonlySet<string>
  interactiveLoginAllAgents: boolean
  keepAliveSsoJump: boolean
  /** Optional only for legacy test doubles; the parser return type is complete. */
  browserProvider?: 'steel' | 'browserless'
  browserShardId?: string
  maxInteractiveSessions?: number
  maxSessionsPerShard?: number
  interactiveReconnectBaseDelayMs?: number
  interactiveReconnectMaxDelayMs?: number
}

export type ConfiguredNationalLifeEnv = NationalLifeEnv &
  Required<
    Pick<
      NationalLifeEnv,
      | 'browserProvider'
      | 'browserShardId'
      | 'maxInteractiveSessions'
      | 'maxSessionsPerShard'
      | 'interactiveReconnectBaseDelayMs'
      | 'interactiveReconnectMaxDelayMs'
    >
  >

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
  NATIONAL_LIFE_VIEWER_APP_ORIGINS: z.string().trim().min(1).optional(),
  NATIONAL_LIFE_VIEWER_BIND_HOST: z.string().trim().min(1),
  NATIONAL_LIFE_VIEWER_PORT: z.string().trim().min(1),
  NATIONAL_LIFE_RUNTIME_WORKER_ID: z.string().trim().min(1).max(200),
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED: z.string().trim().min(1),
  NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS: z.string(),
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS: z.string().trim().min(1).default('false'),
  NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP: z.string().trim().min(1).default('false'),
  NATIONAL_LIFE_BROWSER_PROVIDER: z
    .enum(['steel', 'browserless'])
    .default(NATIONAL_LIFE_DEFAULT_BROWSER_PROVIDER),
  NATIONAL_LIFE_BROWSER_SHARD_ID: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default(NATIONAL_LIFE_DEFAULT_BROWSER_SHARD_ID),
  NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS: z.string().trim().min(1),
  NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD: z.string().trim().min(1),
  NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS: z
    .string()
    .trim()
    .min(1)
    .default(String(NATIONAL_LIFE_DEFAULT_RECONNECT_BASE_DELAY_MS)),
  NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS: z
    .string()
    .trim()
    .min(1)
    .default(String(NATIONAL_LIFE_DEFAULT_RECONNECT_MAX_DELAY_MS)),
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

function parseSteelBaseUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(
      'STEEL_BASE_URL must be an HTTPS URL or the private national-life-steel Docker service URL',
    )
  }

  if (value.includes('*')) {
    throw new Error(
      'STEEL_BASE_URL must be an HTTPS URL or the private national-life-steel Docker service URL',
    )
  }

  if (parsed.protocol === 'https:') {
    return parsed
  }

  const isPrivateDockerService =
    parsed.protocol === 'http:' &&
    parsed.hostname === 'national-life-steel' &&
    parsed.port === '3000' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === ''

  if (!isPrivateDockerService) {
    throw new Error(
      'STEEL_BASE_URL must be an HTTPS URL or the private national-life-steel Docker service URL',
    )
  }

  return parsed
}

function parseHttpsOrigins(name: string, rawOrigins: string) {
  const origins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (origins.length === 0) {
    throw new Error(`${name} must include exact HTTPS origins`)
  }
  return origins.map((origin) =>
    parseHttpsOrigin(`${name} origins`, origin),
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

function parsePositiveInteger(name: string, value: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
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

let cachedEnv: ConfiguredNationalLifeEnv | undefined

export function getNationalLifeEnv(): ConfiguredNationalLifeEnv {
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
    NATIONAL_LIFE_VIEWER_APP_ORIGINS:
      process.env.NATIONAL_LIFE_VIEWER_APP_ORIGINS,
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
    NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS:
      process.env.NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS,
    NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP:
      process.env.NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NATIONAL_LIFE_BROWSER_PROVIDER: process.env.NATIONAL_LIFE_BROWSER_PROVIDER,
    NATIONAL_LIFE_BROWSER_SHARD_ID: process.env.NATIONAL_LIFE_BROWSER_SHARD_ID,
    NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS:
      process.env.NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS,
    NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD:
      process.env.NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD,
    NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS:
      process.env.NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS,
    NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS:
      process.env.NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS,
  }
  const parsed = rawNationalLifeEnvSchema.parse(rawEnv)
  const steelBaseUrl = parseSteelBaseUrl(parsed.STEEL_BASE_URL)
  const portalOrigins = parseHttpsOrigins(
    'NATIONAL_LIFE_PORTAL_ORIGINS',
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
  const interactiveLoginAllAgents = parseBoolean(
    'NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS',
    parsed.NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS,
  )
  // Off until a probe shows the downstream SSO window is idle-based. Turning it
  // on adds an `/authorize` round trip to every keep-alive tick, so it is a
  // deliberate change in how often the carrier's IdP is touched.
  const keepAliveSsoJump = parseBoolean(
    'NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP',
    parsed.NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP,
  )
  parseHttpsOrigin('BETTER_AUTH_URL', parsed.BETTER_AUTH_URL)
  if (interactiveLoginAllAgents && interactiveLoginAgentIds.size > 0) {
    throw new Error(
      'NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS cannot be combined with a named allowlist',
    )
  }
  if (
    interactiveLoginEnabled &&
    !interactiveLoginAllAgents &&
    interactiveLoginAgentIds.size === 0
  ) {
    throw new Error(
      'NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS must list exact agent IDs when enabled',
    )
  }

  const maxInteractiveSessions = parsePositiveInteger(
    'NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS',
    parsed.NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS,
  )
  const maxSessionsPerShard = parsePositiveInteger(
    'NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD',
    parsed.NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD,
  )
  if (maxInteractiveSessions < maxSessionsPerShard) {
    throw new Error(
      'NATIONAL_LIFE_MAX_INTERACTIVE_SESSIONS must be at least NATIONAL_LIFE_MAX_SESSIONS_PER_SHARD',
    )
  }
  const interactiveReconnectBaseDelayMs = parsePositiveInteger(
    'NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS',
    parsed.NATIONAL_LIFE_INTERACTIVE_RECONNECT_BASE_DELAY_MS,
  )
  const interactiveReconnectMaxDelayMs = parsePositiveInteger(
    'NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS',
    parsed.NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS,
  )
  if (interactiveReconnectBaseDelayMs > interactiveReconnectMaxDelayMs) {
    throw new Error(
      'NATIONAL_LIFE_INTERACTIVE_RECONNECT_MAX_DELAY_MS must be at least the base delay',
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
    viewerAppOrigins: parseHttpsOrigins(
      'NATIONAL_LIFE_VIEWER_APP_ORIGINS',
      parsed.NATIONAL_LIFE_VIEWER_APP_ORIGINS ?? parsed.BETTER_AUTH_URL,
    ),
    viewerBindHost: parseBindHost(
      parsed.NATIONAL_LIFE_VIEWER_BIND_HOST,
    ),
    viewerPort: parseViewerPort(parsed.NATIONAL_LIFE_VIEWER_PORT),
    runtimeWorkerId: parsed.NATIONAL_LIFE_RUNTIME_WORKER_ID,
    interactiveLoginEnabled,
    interactiveLoginAgentIds,
    interactiveLoginAllAgents,
    keepAliveSsoJump,
    browserProvider: parsed.NATIONAL_LIFE_BROWSER_PROVIDER,
    browserShardId: parsed.NATIONAL_LIFE_BROWSER_SHARD_ID,
    maxInteractiveSessions,
    maxSessionsPerShard,
    interactiveReconnectBaseDelayMs,
    interactiveReconnectMaxDelayMs,
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
