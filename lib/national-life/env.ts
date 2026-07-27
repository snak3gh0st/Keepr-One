import 'server-only'
import { Buffer } from 'node:buffer'
import { z } from 'zod'

type RawNationalLifeEnv = {
  STEEL_BASE_URL?: string
  STEEL_API_KEY?: string
  NATIONAL_LIFE_PORTAL_ORIGINS?: string
  NATIONAL_LIFE_PORTAL_LOGIN_URL?: string
  NATIONAL_LIFE_CREDENTIAL_SCOPE_ID?: string
  NATIONAL_LIFE_CREDENTIAL_KEY_VERSION?: string
  NATIONAL_LIFE_CREDENTIAL_KEYS?: string
}

export type NationalLifeEnv = {
  steelBaseUrl: string
  steelApiKey?: string
  portalOrigins: string[]
  portalLoginUrl: string
  credentialScopeId: string
  credentialKeyVersion: string
  credentialKeys: Record<string, string>
}

const httpsUrl = z.string().trim().url().refine((value) => value.startsWith('https://'), {
  message: 'Expected an HTTPS URL',
})

const rawNationalLifeEnvSchema = z.object({
  STEEL_BASE_URL: httpsUrl,
  STEEL_API_KEY: z.string().trim().min(1).optional(),
  NATIONAL_LIFE_PORTAL_ORIGINS: z.string().trim().min(1),
  NATIONAL_LIFE_PORTAL_LOGIN_URL: httpsUrl,
  NATIONAL_LIFE_CREDENTIAL_SCOPE_ID: z.string().trim().min(1),
  NATIONAL_LIFE_CREDENTIAL_KEY_VERSION: z.string().trim().min(1),
  NATIONAL_LIFE_CREDENTIAL_KEYS: z.string().trim().min(1),
})

function ensureBase64Key(version: string, base64Key: string) {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error(`NATIONAL_LIFE_CREDENTIAL_KEYS.${version} must be a base64-encoded 32-byte key`)
  }
}

function parsePortalOrigins(rawOrigins: string) {
  const origins = rawOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (origins.length === 0) {
    throw new Error('NATIONAL_LIFE_PORTAL_ORIGINS must include at least one HTTPS origin')
  }

  return origins.map((origin) => {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
      throw new Error('NATIONAL_LIFE_PORTAL_ORIGINS entries must be HTTPS origins')
    }
    return parsed.origin
  })
}

function parseCredentialKeys(rawKeys: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawKeys)
  } catch {
    throw new Error('NATIONAL_LIFE_CREDENTIAL_KEYS must be valid JSON')
  }

  const keys = z.record(z.string().trim().min(1), z.string().trim().min(1)).parse(parsed)
  for (const [version, base64Key] of Object.entries(keys)) {
    ensureBase64Key(version, base64Key)
  }
  return keys
}

let cachedEnv: NationalLifeEnv | undefined

export function getNationalLifeEnv(): NationalLifeEnv {
  if (cachedEnv) {
    return cachedEnv
  }

  const rawEnv: RawNationalLifeEnv = {
    STEEL_BASE_URL: process.env.STEEL_BASE_URL,
    STEEL_API_KEY: process.env.STEEL_API_KEY,
    NATIONAL_LIFE_PORTAL_ORIGINS: process.env.NATIONAL_LIFE_PORTAL_ORIGINS,
    NATIONAL_LIFE_PORTAL_LOGIN_URL: process.env.NATIONAL_LIFE_PORTAL_LOGIN_URL,
    NATIONAL_LIFE_CREDENTIAL_SCOPE_ID: process.env.NATIONAL_LIFE_CREDENTIAL_SCOPE_ID,
    NATIONAL_LIFE_CREDENTIAL_KEY_VERSION: process.env.NATIONAL_LIFE_CREDENTIAL_KEY_VERSION,
    NATIONAL_LIFE_CREDENTIAL_KEYS: process.env.NATIONAL_LIFE_CREDENTIAL_KEYS,
  }

  const parsed = rawNationalLifeEnvSchema.parse(rawEnv)
  const portalOrigins = parsePortalOrigins(parsed.NATIONAL_LIFE_PORTAL_ORIGINS)
  const portalLoginUrl = new URL(parsed.NATIONAL_LIFE_PORTAL_LOGIN_URL)

  if (!portalOrigins.includes(portalLoginUrl.origin)) {
    throw new Error('NATIONAL_LIFE_PORTAL_LOGIN_URL origin must be listed in NATIONAL_LIFE_PORTAL_ORIGINS')
  }

  const credentialKeys = parseCredentialKeys(parsed.NATIONAL_LIFE_CREDENTIAL_KEYS)
  if (!(parsed.NATIONAL_LIFE_CREDENTIAL_KEY_VERSION in credentialKeys)) {
    throw new Error('NATIONAL_LIFE_CREDENTIAL_KEY_VERSION must exist in NATIONAL_LIFE_CREDENTIAL_KEYS')
  }

  cachedEnv = {
    steelBaseUrl: parsed.STEEL_BASE_URL,
    steelApiKey: parsed.STEEL_API_KEY,
    portalOrigins,
    portalLoginUrl: portalLoginUrl.toString(),
    credentialScopeId: parsed.NATIONAL_LIFE_CREDENTIAL_SCOPE_ID,
    credentialKeyVersion: parsed.NATIONAL_LIFE_CREDENTIAL_KEY_VERSION,
    credentialKeys,
  }

  return cachedEnv
}
