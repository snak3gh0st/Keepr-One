import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SessionContext } from 'steel-sdk'
import { z } from 'zod'

export type BrowserContextBinding = {
  agentId: string
  scopeId: string
  provider: string
  purpose: 'AUTHENTICATED_BROWSER_CONTEXT' | 'INTERACTIVE_ATTEMPT_RUNTIME'
  formatVersion: 1
}

export type AttemptRuntime = {
  steelSessionId: string
  debugUrl: string
  expiresAt: string
}

export type EncryptedBrowserSecret = {
  algorithm: 'aes-256-gcm'
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
}

type ActiveEncryptionKey = {
  version: string
  base64Key: string
}

const cookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    partitionKey: z
      .object({
        hasCrossSiteAncestor: z.boolean(),
        topLevelSite: z.string(),
      })
      .strict()
      .optional(),
    path: z.string().optional(),
    priority: z.enum(['Low', 'Medium', 'High']).optional(),
    sameParty: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    secure: z.boolean().optional(),
    session: z.boolean().optional(),
    size: z.number().optional(),
    sourcePort: z.number().optional(),
    sourceScheme: z.enum(['Unset', 'NonSecure', 'Secure']).optional(),
    url: z.string().optional(),
  })
  .strict()

const blobFileSchema = z
  .object({
    blobNumber: z.number(),
    mimeType: z.string(),
    size: z.number(),
    filename: z.string().optional(),
    lastModified: z.string().optional(),
    path: z.string().optional(),
  })
  .strict()

const indexedDbSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    data: z.array(
      z
        .object({
          id: z.number(),
          name: z.string(),
          records: z.array(
            z
              .object({
                key: z.unknown(),
                value: z.unknown(),
                blobFiles: z.array(blobFileSchema).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()

const storageSchema = z.record(z.string(), z.record(z.string(), z.string()))

const sessionContextSchema = z
  .object({
    cookies: z.array(cookieSchema).optional(),
    indexedDB: z.record(z.string(), z.array(indexedDbSchema)).optional(),
    localStorage: storageSchema.optional(),
    sessionStorage: storageSchema.optional(),
  })
  .strict()

const attemptRuntimeSchema = z
  .object({
    steelSessionId: z.string(),
    debugUrl: z.string(),
    expiresAt: z.string(),
  })
  .strict()

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    )
  }

  return value
}

function canonicalJson(value: unknown) {
  return JSON.stringify(sortJsonValue(value))
}

function decodeBase64(value: string) {
  const isCanonicalBase64 =
    value &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)

  if (!isCanonicalBase64) {
    throw new Error('Invalid base64')
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new Error('Invalid base64')
  }

  return decoded
}

function decodeKey(base64Key: string) {
  const key = decodeBase64(base64Key)
  if (key.length !== 32) {
    throw new Error('Invalid encryption key')
  }
  return key
}

function encryptSecret<T>(
  value: unknown,
  binding: BrowserContextBinding,
  activeKey: ActiveEncryptionKey,
  schema: z.ZodType<T>,
): EncryptedBrowserSecret {
  try {
    const validatedValue = schema.parse(value)
    const key = decodeKey(activeKey.base64Key)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(canonicalJson(binding)))

    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(canonicalJson(validatedValue))),
      cipher.final(),
    ])

    return {
      algorithm: 'aes-256-gcm',
      keyVersion: activeKey.version,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    }
  } catch {
    throw new Error('Browser context encryption failed')
  }
}

function decryptSecret<T>(
  value: EncryptedBrowserSecret,
  binding: BrowserContextBinding,
  keys: Record<string, string>,
  schema: z.ZodType<T>,
): T {
  try {
    if (value.algorithm !== 'aes-256-gcm' || !value.keyVersion) {
      throw new Error('Invalid encrypted secret metadata')
    }

    const keyMaterial = keys[value.keyVersion]
    if (!keyMaterial) {
      throw new Error('Unavailable encryption key')
    }

    const key = decodeKey(keyMaterial)
    const iv = decodeBase64(value.iv)
    const ciphertext = decodeBase64(value.ciphertext)
    const authTag = decodeBase64(value.authTag)

    if (iv.length !== 12 || ciphertext.length === 0 || authTag.length !== 16) {
      throw new Error('Invalid encrypted secret payload')
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(canonicalJson(binding)))
    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')

    return schema.parse(JSON.parse(plaintext))
  } catch {
    throw new Error('Browser context decryption failed')
  }
}

export function encryptBrowserContext(
  context: SessionContext,
  binding: BrowserContextBinding,
  activeKey: ActiveEncryptionKey,
): EncryptedBrowserSecret {
  return encryptSecret(context, binding, activeKey, sessionContextSchema)
}

export function decryptBrowserContext(
  value: EncryptedBrowserSecret,
  binding: BrowserContextBinding,
  keys: Record<string, string>,
): SessionContext {
  return decryptSecret(value, binding, keys, sessionContextSchema) as SessionContext
}

export function encryptAttemptRuntime(
  runtime: AttemptRuntime,
  binding: BrowserContextBinding,
  activeKey: ActiveEncryptionKey,
): EncryptedBrowserSecret {
  return encryptSecret(runtime, binding, activeKey, attemptRuntimeSchema)
}

export function decryptAttemptRuntime(
  value: EncryptedBrowserSecret,
  binding: BrowserContextBinding,
  keys: Record<string, string>,
): AttemptRuntime {
  return decryptSecret(value, binding, keys, attemptRuntimeSchema)
}
