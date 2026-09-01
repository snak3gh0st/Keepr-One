import 'server-only'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  parseCredentialBinding,
  parseCredentialPlaintext,
  type CredentialBindingV1,
  type CredentialPlaintextV1,
} from './contracts'

const VAULT_TIMEOUT_MS = 3_000
const VAULT_MAX_RESPONSE_BYTES = 64 * 1024
const vaultNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const vaultCiphertextPattern = /^vault:v([1-9][0-9]*):[A-Za-z0-9+/=_-]+$/

export type StoredVaultCredential = Readonly<{
  encryptionProvider: 'VAULT_TRANSIT'
  formatVersion: 1
  keyVersion: string
  encryptedPayload: string
}>

export interface CredentialEncryptPort {
  encrypt(input: {
    plaintext: CredentialPlaintextV1
    binding: CredentialBindingV1
  }): Promise<StoredVaultCredential>
}

export interface CredentialDecryptPort {
  decrypt(input: {
    stored: StoredVaultCredential
    binding: CredentialBindingV1
  }): Promise<CredentialPlaintextV1>
}

export type CredentialVaultErrorCode =
  | 'VAULT_UNAVAILABLE'
  | 'VAULT_REJECTED'
  | 'VAULT_PAYLOAD_INVALID'

export class CredentialVaultError extends Error {
  constructor(readonly code: CredentialVaultErrorCode) {
    super(code)
    this.name = 'CredentialVaultError'
  }
}

export type VaultTransitClientConfig = Readonly<{
  vaultAddress: string
  mount: string
  key: string
  tokenFile: string
}>

type VaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type VaultTransitDependencies = Readonly<{
  fetch?: VaultFetch
  readTokenFile?: (tokenFile: string) => Promise<string>
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
}>

const storedVaultCredentialSchema = z.strictObject({
  encryptionProvider: z.literal('VAULT_TRANSIT'),
  formatVersion: z.literal(1),
  keyVersion: z.string().regex(/^v[1-9][0-9]*$/),
  encryptedPayload: z.string().min(1).max(8_192).regex(vaultCiphertextPattern),
})

const encryptResponseSchema = z.object({
  data: z.object({
    ciphertext: z.string().min(1).max(8_192).regex(vaultCiphertextPattern),
  }),
})

const decryptResponseSchema = z.object({
  data: z.object({
    plaintext: z.string().min(1).max(4_096),
  }),
})

function parseClientConfig(config: VaultTransitClientConfig) {
  let address: URL
  try {
    address = new URL(config.vaultAddress)
  } catch {
    throw new Error('Invalid Vault Transit configuration')
  }
  if (
    address.protocol !== 'https:' ||
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    (address.pathname !== '/' && address.pathname !== '') ||
    address.origin !== config.vaultAddress.replace(/\/$/, '')
  ) {
    throw new Error('Invalid Vault Transit configuration')
  }
  if (!vaultNamePattern.test(config.mount) || !vaultNamePattern.test(config.key)) {
    throw new Error('Invalid Vault Transit configuration')
  }
  if (!path.isAbsolute(config.tokenFile) || config.tokenFile.includes('\0')) {
    throw new Error('Invalid Vault Transit configuration')
  }
  return { ...config, vaultAddress: address.origin }
}

function canonicalJson(value: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
  return JSON.stringify(sorted)
}

function bindingBase64(binding: CredentialBindingV1): string {
  const parsed = parseCredentialBinding(binding)
  if (!parsed) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
  return Buffer.from(canonicalJson(parsed)).toString('base64')
}

function plaintextBase64(plaintext: CredentialPlaintextV1): string {
  const parsed = parseCredentialPlaintext(plaintext)
  if (!parsed) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
  return Buffer.from(canonicalJson(parsed)).toString('base64')
}

function decodeCanonicalBase64(value: string): string | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) return null
  return bytes.toString('utf8')
}

function ciphertextVersion(ciphertext: string): string | null {
  const match = vaultCiphertextPattern.exec(ciphertext)
  return match ? `v${match[1]}` : null
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > VAULT_MAX_RESPONSE_BYTES) {
    throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > VAULT_MAX_RESPONSE_BYTES) {
    throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
  }
}

function mapStatus(status: number): CredentialVaultError {
  return status >= 500
    ? new CredentialVaultError('VAULT_UNAVAILABLE')
    : new CredentialVaultError('VAULT_REJECTED')
}

function dependencies(input: VaultTransitDependencies) {
  return {
    fetch: input.fetch ?? globalThis.fetch,
    readTokenFile: input.readTokenFile ?? ((tokenFile: string) => readFile(tokenFile, 'utf8')),
    createTimeoutSignal: input.createTimeoutSignal ?? ((timeoutMs: number) => AbortSignal.timeout(timeoutMs)),
  }
}

function createRequester(
  rawConfig: VaultTransitClientConfig,
  dependencyOverrides: VaultTransitDependencies,
) {
  const config = parseClientConfig(rawConfig)
  const deps = dependencies(dependencyOverrides)

  return async (operation: 'encrypt' | 'decrypt', body: Record<string, unknown>) => {
    let token: string
    try {
      token = (await deps.readTokenFile(config.tokenFile)).trim()
    } catch {
      throw new CredentialVaultError('VAULT_UNAVAILABLE')
    }
    if (!/^\S{1,4096}$/.test(token)) {
      throw new CredentialVaultError('VAULT_UNAVAILABLE')
    }

    let response: Response
    try {
      response = await deps.fetch(
        `${config.vaultAddress}/v1/${config.mount}/${operation}/${config.key}`,
        {
          method: 'POST',
          redirect: 'error',
          signal: deps.createTimeoutSignal(VAULT_TIMEOUT_MS),
          headers: {
            'content-type': 'application/json',
            'x-vault-token': token,
          },
          body: JSON.stringify(body),
        },
      )
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error
      throw new CredentialVaultError('VAULT_UNAVAILABLE')
    }

    if (!response.ok) throw mapStatus(response.status)
    return parseJsonResponse(response)
  }
}

export function createVaultTransitEncryptClient(
  config: VaultTransitClientConfig,
  dependencyOverrides: VaultTransitDependencies = {},
): CredentialEncryptPort {
  const request = createRequester(config, dependencyOverrides)
  return {
    async encrypt(input) {
      const context = bindingBase64(input.binding)
      const raw = await request('encrypt', {
        plaintext: plaintextBase64(input.plaintext),
        context,
        associated_data: context,
      })
      const parsed = encryptResponseSchema.safeParse(raw)
      if (!parsed.success) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      const keyVersion = ciphertextVersion(parsed.data.data.ciphertext)
      if (!keyVersion) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      return {
        encryptionProvider: 'VAULT_TRANSIT',
        formatVersion: 1,
        keyVersion,
        encryptedPayload: parsed.data.data.ciphertext,
      }
    },
  }
}

export function createVaultTransitDecryptClient(
  config: VaultTransitClientConfig,
  dependencyOverrides: VaultTransitDependencies = {},
): CredentialDecryptPort {
  const request = createRequester(config, dependencyOverrides)
  return {
    async decrypt(input) {
      const stored = storedVaultCredentialSchema.safeParse(input.stored)
      if (!stored.success || ciphertextVersion(stored.data.encryptedPayload) !== stored.data.keyVersion) {
        throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      }
      const context = bindingBase64(input.binding)
      const raw = await request('decrypt', {
        ciphertext: stored.data.encryptedPayload,
        context,
        associated_data: context,
      })
      const response = decryptResponseSchema.safeParse(raw)
      if (!response.success) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      const plaintextJson = decodeCanonicalBase64(response.data.data.plaintext)
      if (!plaintextJson) throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')

      let candidate: unknown
      try {
        candidate = JSON.parse(plaintextJson)
      } catch {
        throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      }
      const plaintext = parseCredentialPlaintext(candidate)
      if (!plaintext || canonicalJson(plaintext) !== plaintextJson) {
        throw new CredentialVaultError('VAULT_PAYLOAD_INVALID')
      }
      return plaintext
    },
  }
}
