import 'server-only'

import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM } from './constants'
import { getGoogleCalendarTokenKey, type GoogleCalendarEnv } from './env'

export type GoogleEncryptedSecret = {
  keyVersion: string
  algorithm: typeof GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM
  iv: string
  ciphertext: string
  authTag: string
}

function canonicalBinding(binding: Record<string, string>) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(binding).sort(([left], [right]) => left.localeCompare(right))),
  )
}

function decodeCanonicalBase64(name: string, value: string) {
  const canonical = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  const decoded = canonical ? Buffer.from(value, 'base64') : Buffer.alloc(0)
  if (!canonical || decoded.toString('base64') !== value) {
    throw new Error(`${name} is invalid`)
  }
  return decoded
}

export function encryptGoogleSecret(
  plaintext: string,
  binding: Record<string, string>,
  env: GoogleCalendarEnv,
  iv = new Uint8Array(randomBytes(12)),
): GoogleEncryptedSecret {
  if (!plaintext) throw new Error('Google Calendar secret must not be empty')
  const key = getGoogleCalendarTokenKey(env)
  const cipher = createCipheriv(GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(canonicalBinding(binding)))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    keyVersion: env.tokenKeyVersion,
    algorithm: GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM,
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptGoogleSecret(
  encrypted: GoogleEncryptedSecret,
  binding: Record<string, string>,
  env: GoogleCalendarEnv,
) {
  try {
    if (encrypted.algorithm !== GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM) {
      throw new Error('Unsupported algorithm')
    }
    const iv = decodeCanonicalBase64('iv', encrypted.iv)
    const ciphertext = decodeCanonicalBase64('ciphertext', encrypted.ciphertext)
    const authTag = decodeCanonicalBase64('authTag', encrypted.authTag)
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid encrypted payload')
    }
    const decipher = createDecipheriv(
      GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM,
      getGoogleCalendarTokenKey(env, encrypted.keyVersion),
      iv,
    )
    decipher.setAAD(Buffer.from(canonicalBinding(binding)))
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Google Calendar secret decryption failed')
  }
}

export function hashGoogleSecret(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function safeSecretHashEquals(value: string, expectedHash: string) {
  const actual = Buffer.from(hashGoogleSecret(value), 'hex')
  const expected = /^[a-f0-9]{64}$/i.test(expectedHash)
    ? Buffer.from(expectedHash, 'hex')
    : Buffer.alloc(actual.length)
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}
