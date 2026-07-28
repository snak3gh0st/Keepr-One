import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { EncryptedSecret } from './credential-crypto'

export type MfaContinuation = {
  steelSessionId: string
  debugUrl: string
  expiresAt: string
}

export type MfaContinuationContext = {
  agentId: string
  jobId: string
  scopeId: string
}

export type DecryptMfaContinuationOptions = {
  now?: () => Date
  allowExpired?: boolean
}

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

function decodeKey(base64Key: string) {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error('Invalid MFA continuation key material')
  }
  return key
}

function buildAssociatedData(context: MfaContinuationContext) {
  return Buffer.from(canonicalJson({ purpose: 'NATIONAL_LIFE_MFA', ...context }))
}

function toBase64(value: Buffer) {
  return value.toString('base64')
}

export function encryptMfaContinuation(
  value: MfaContinuation,
  context: MfaContinuationContext,
  activeKey: { version: string; base64Key: string },
): EncryptedSecret {
  const key = decodeKey(activeKey.base64Key)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(buildAssociatedData(context))

  const plaintext = Buffer.from(canonicalJson(value))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    algorithm: 'aes-256-gcm',
    keyVersion: activeKey.version,
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    authTag: toBase64(authTag),
  }
}

export function decryptMfaContinuation(
  value: EncryptedSecret,
  context: MfaContinuationContext,
  keys: Record<string, string>,
  options: DecryptMfaContinuationOptions = {},
): MfaContinuation {
  if (value.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported MFA continuation encryption algorithm')
  }

  const keyMaterial = keys[value.keyVersion]
  if (!keyMaterial) {
    throw new Error('MFA continuation key version is unavailable')
  }

  const key = decodeKey(keyMaterial)
  const iv = Buffer.from(value.iv, 'base64')
  const authTag = Buffer.from(value.authTag, 'base64')
  const ciphertext = Buffer.from(value.ciphertext, 'base64')

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Encrypted MFA continuation payload is invalid')
  }

  let continuation: MfaContinuation

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(buildAssociatedData(context))
    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as Partial<MfaContinuation>

    if (
      typeof parsed.steelSessionId !== 'string' ||
      typeof parsed.debugUrl !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      throw new Error('Invalid MFA continuation payload shape')
    }

    continuation = {
      steelSessionId: parsed.steelSessionId,
      debugUrl: parsed.debugUrl,
      expiresAt: parsed.expiresAt,
    }
  } catch {
    throw new Error('MFA continuation decryption failed')
  }

  const now = (options.now ?? (() => new Date()))()
  if (!options.allowExpired && new Date(continuation.expiresAt).getTime() <= now.getTime()) {
    throw new Error('MFA continuation expired')
  }

  return continuation
}
