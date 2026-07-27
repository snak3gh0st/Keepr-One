import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export type CredentialPlaintext = { username: string; password: string }
export type CredentialContext = { agentId: string; scopeId: string; provider: string }
export type EncryptedSecret = {
  algorithm: 'aes-256-gcm'
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
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
    throw new Error('Invalid credential key material')
  }
  return key
}

function buildAssociatedData(context: CredentialContext) {
  return Buffer.from(canonicalJson(context))
}

function toBase64(value: Buffer) {
  return value.toString('base64')
}

export function encryptCredential(
  value: CredentialPlaintext,
  context: CredentialContext,
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

export function decryptCredential(
  value: EncryptedSecret,
  context: CredentialContext,
  keys: Record<string, string>,
): CredentialPlaintext {
  if (value.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported credential encryption algorithm')
  }

  const keyMaterial = keys[value.keyVersion]
  if (!keyMaterial) {
    throw new Error('Credential key version is unavailable')
  }

  const key = decodeKey(keyMaterial)
  const iv = Buffer.from(value.iv, 'base64')
  const authTag = Buffer.from(value.authTag, 'base64')
  const ciphertext = Buffer.from(value.ciphertext, 'base64')

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Encrypted credential payload is invalid')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(buildAssociatedData(context))
    decipher.setAuthTag(authTag)

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plaintext) as Partial<CredentialPlaintext>

    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') {
      throw new Error('Invalid credential payload shape')
    }

    return {
      username: parsed.username,
      password: parsed.password,
    }
  } catch {
    throw new Error('Credential decryption failed')
  }
}
