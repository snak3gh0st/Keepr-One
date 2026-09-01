type CredentialOperation = Readonly<{
  kind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
  id: string
  authEpoch: number
}>

type SealedCredentialLease = Readonly<{
  schemaVersion: 1
  leaseId: string
  expiresAt: string
  operation: CredentialOperation
  keyAlgorithm: 'RSA-OAEP-256'
  contentAlgorithm: 'AES-256-GCM'
  wrappedKey: string
  iv: string
  ciphertext: string
}>

export type OpenedCarrierCredential = Readonly<{
  formatVersion: 1
  username: string
  password: string
}>

const identifier = /^[A-Za-z0-9._:-]{1,128}$/
const base64url = /^[A-Za-z0-9_-]+$/

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function decodeBase64Url(
  value: unknown,
  minimum: number,
  maximum: number,
): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || !base64url.test(value)) return null
  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    if (bytes.byteLength < minimum || bytes.byteLength > maximum) return null
    const canonical = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return canonical === value ? bytes : null
  } catch {
    return null
  }
}

function parseOperation(value: unknown): CredentialOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const operation = value as Record<string, unknown>
  if (!exactKeys(operation, ['authEpoch', 'id', 'kind'])) return null
  if (operation.kind !== 'SYNC_RUN' && operation.kind !== 'CONNECTOR_COMMAND') return null
  if (typeof operation.id !== 'string' || !identifier.test(operation.id)) return null
  if (!Number.isInteger(operation.authEpoch) || Number(operation.authEpoch) < 0) return null
  return {
    kind: operation.kind,
    id: operation.id,
    authEpoch: Number(operation.authEpoch),
  }
}

function parseEnvelope(value: unknown): {
  envelope: SealedCredentialLease
  wrappedKey: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  ciphertext: Uint8Array<ArrayBuffer>
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as Record<string, unknown>
  if (!exactKeys(envelope, [
    'ciphertext',
    'contentAlgorithm',
    'expiresAt',
    'iv',
    'keyAlgorithm',
    'leaseId',
    'operation',
    'schemaVersion',
    'wrappedKey',
  ])) return null
  const operation = parseOperation(envelope.operation)
  const wrappedKey = decodeBase64Url(envelope.wrappedKey, 384, 512)
  const iv = decodeBase64Url(envelope.iv, 12, 12)
  const ciphertext = decodeBase64Url(envelope.ciphertext, 17, 2_048)
  if (
    envelope.schemaVersion !== 1 ||
    typeof envelope.leaseId !== 'string' || !identifier.test(envelope.leaseId) ||
    typeof envelope.expiresAt !== 'string' || !Number.isFinite(Date.parse(envelope.expiresAt)) ||
    envelope.keyAlgorithm !== 'RSA-OAEP-256' ||
    envelope.contentAlgorithm !== 'AES-256-GCM' ||
    !operation || !wrappedKey || !iv || !ciphertext
  ) return null
  return {
    envelope: { ...envelope, operation } as SealedCredentialLease,
    wrappedKey,
    iv,
    ciphertext,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

function sameOperation(left: CredentialOperation, right: CredentialOperation) {
  return left.kind === right.kind && left.id === right.id && left.authEpoch === right.authEpoch
}

function parsePlaintext(bytes: Uint8Array): OpenedCarrierCredential | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!exactKeys(record, ['formatVersion', 'password', 'username'])) return null
  if (
    record.formatVersion !== 1 ||
    typeof record.username !== 'string' || record.username.length < 1 || record.username.length > 128 ||
    record.username.trim().length === 0 ||
    typeof record.password !== 'string' || record.password.length < 1 || record.password.length > 256
  ) return null
  return { formatVersion: 1, username: record.username, password: record.password }
}

export async function openSealedCredentialLease(
  value: unknown,
  privateKey: CryptoKey,
  expected: { operation: CredentialOperation; now?: Date },
): Promise<OpenedCarrierCredential> {
  const parsed = parseEnvelope(value)
  const now = expected.now ?? new Date()
  if (
    !parsed ||
    privateKey.extractable || privateKey.type !== 'private' || !privateKey.usages.includes('decrypt') ||
    !sameOperation(parsed.envelope.operation, expected.operation) ||
    Date.parse(parsed.envelope.expiresAt) <= now.getTime()
  ) throw new Error('CREDENTIAL_LEASE_INVALID')

  let aesBytes: Uint8Array<ArrayBuffer> | undefined
  let plaintext: Uint8Array<ArrayBuffer> | undefined
  try {
    const unwrapped = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      parsed.wrappedKey,
    )
    aesBytes = new Uint8Array(unwrapped)
    if (aesBytes.byteLength !== 32) throw new Error('CREDENTIAL_LEASE_INVALID')
    const aesKey = await crypto.subtle.importKey(
      'raw',
      aesBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    const header = {
      schemaVersion: parsed.envelope.schemaVersion,
      leaseId: parsed.envelope.leaseId,
      expiresAt: parsed.envelope.expiresAt,
      operation: parsed.envelope.operation,
      keyAlgorithm: parsed.envelope.keyAlgorithm,
      contentAlgorithm: parsed.envelope.contentAlgorithm,
    }
    const aad = new TextEncoder().encode(canonicalJson(header))
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: parsed.iv, additionalData: aad, tagLength: 128 },
      aesKey,
      parsed.ciphertext,
    )
    plaintext = new Uint8Array(opened)
    const credential = parsePlaintext(plaintext)
    if (!credential) throw new Error('CREDENTIAL_LEASE_INVALID')
    return credential
  } catch {
    throw new Error('CREDENTIAL_LEASE_INVALID')
  } finally {
    aesBytes?.fill(0)
    plaintext?.fill(0)
    parsed.wrappedKey.fill(0)
    parsed.iv.fill(0)
    parsed.ciphertext.fill(0)
  }
}
