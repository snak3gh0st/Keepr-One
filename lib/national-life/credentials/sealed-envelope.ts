import 'server-only'

import { randomBytes, webcrypto } from 'node:crypto'
import { publicRsaOaepJwkSchema } from '@/lib/national-life/local-connector/contracts'
import {
  parseCredentialPlaintext,
  parseSealedCredentialLease,
  type CredentialPlaintextV1,
  type SealedCredentialLeaseV1,
} from './contracts'

type CredentialOperation = SealedCredentialLeaseV1['operation']

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function metadata(input: {
  leaseId: string
  expiresAt: string
  operation: CredentialOperation
}) {
  return {
    schemaVersion: 1 as const,
    leaseId: input.leaseId,
    expiresAt: input.expiresAt,
    operation: input.operation,
    keyAlgorithm: 'RSA-OAEP-256' as const,
    contentAlgorithm: 'AES-256-GCM' as const,
  }
}

export async function sealCredentialForDevice(input: {
  credential: CredentialPlaintextV1
  publicKeyJwk: unknown
  leaseId: string
  expiresAt: Date
  operation: CredentialOperation
}): Promise<SealedCredentialLeaseV1> {
  const credential = parseCredentialPlaintext(input.credential)
  const publicKeyJwk = publicRsaOaepJwkSchema.safeParse(input.publicKeyJwk)
  if (!credential || !publicKeyJwk.success || !Number.isFinite(input.expiresAt.getTime())) {
    throw new Error('CREDENTIAL_LEASE_INVALID')
  }

  const aesBytes = randomBytes(32)
  const iv = randomBytes(12)
  const plaintext = new TextEncoder().encode(canonicalJson(credential))
  try {
    const publicKey = await webcrypto.subtle.importKey(
      'jwk',
      publicKeyJwk.data,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    )
    const aesKey = await webcrypto.subtle.importKey(
      'raw',
      aesBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
    const header = metadata({
      leaseId: input.leaseId,
      expiresAt: input.expiresAt.toISOString(),
      operation: input.operation,
    })
    const aad = new TextEncoder().encode(canonicalJson(header))
    const [wrappedKey, ciphertext] = await Promise.all([
      webcrypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, aesBytes),
      webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
        aesKey,
        plaintext,
      ),
    ])
    const sealed = parseSealedCredentialLease({
      ...header,
      wrappedKey: Buffer.from(wrappedKey).toString('base64url'),
      iv: iv.toString('base64url'),
      ciphertext: Buffer.from(ciphertext).toString('base64url'),
    })
    if (!sealed) throw new Error('CREDENTIAL_LEASE_INVALID')
    return sealed
  } catch (error) {
    if (error instanceof Error && error.message === 'CREDENTIAL_LEASE_INVALID') throw error
    throw new Error('CREDENTIAL_LEASE_INVALID')
  } finally {
    aesBytes.fill(0)
    iv.fill(0)
    plaintext.fill(0)
  }
}
