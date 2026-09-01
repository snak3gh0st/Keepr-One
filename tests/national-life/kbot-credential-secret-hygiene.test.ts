import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { openSealedCredentialLease } from '../../apps/keeprone-connect/lib/credential-envelope'
import { submitNationalLifeCredential } from '../../apps/keeprone-connect/lib/auth-page-contract'
import {
  createCredentialSettingsService,
  type CredentialAuditInput,
  type CredentialRecord,
  type CredentialSettingsPersistence,
} from '../../lib/national-life/credentials/settings-service'
import { sealCredentialForDevice } from '../../lib/national-life/credentials/sealed-envelope'

const username = 'credential-user-sentinel-7e2d'
const password = 'credential-password-sentinel-91af'

function loginPage() {
  return new JSDOM(readFileSync(
    new URL('../fixtures/national-life/auth0-login.html', import.meta.url),
    'utf8',
  ), { url: 'https://nlg-prod.auth0.com/login' })
}

describe('K-Bot credential secret hygiene', () => {
  it('allows plaintext only at Vault encryption and exact form assignment boundaries', async () => {
    const persisted: CredentialRecord[] = []
    const audits: CredentialAuditInput[] = []
    const vaultEncryptRequests: unknown[] = []
    const notifications: unknown[] = []
    const commandEvents: unknown[] = []
    const logs: unknown[] = []
    const caughtErrors: unknown[] = []

    const credential = {
      async findByAgentProvider() { return persisted.at(-1) ?? null },
      async upsert(input: Omit<CredentialRecord, 'id'>) {
        const record = { id: 'credential_1', ...input }
        persisted.push(record)
        return record
      },
      async revoke() { return null },
    }
    const persistence: CredentialSettingsPersistence = {
      credential,
      async transaction(work) {
        return work({
          credential,
          audit: { async create(input) { audits.push(input) } },
        })
      },
    }
    const settings = createCredentialSettingsService({
      persistence,
      encryptPort: {
        async encrypt(input) {
          vaultEncryptRequests.push(input)
          return {
            encryptionProvider: 'VAULT_TRANSIT',
            formatVersion: 1,
            keyVersion: 'v7',
            encryptedPayload: 'vault:v7:Y2lwaGVydGV4dC1vbmx5',
          }
        },
      },
      now: () => new Date('2026-09-01T20:00:00.000Z'),
    })

    await settings.save({ agentId: 'agent_1', userId: 'user_1', username, password })

    const pair = await crypto.subtle.generateKey({
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    }, false, ['encrypt', 'decrypt']) as CryptoKeyPair
    const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const publicKeyJwk: JsonWebKey = {
      kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
      e: exported.e, n: exported.n,
    }
    const operation = { kind: 'SYNC_RUN' as const, id: 'run_1', authEpoch: 1 }
    const sealed = await sealCredentialForDevice({
      credential: { formatVersion: 1, username, password },
      publicKeyJwk,
      leaseId: 'lease_1',
      expiresAt: new Date('2026-09-01T20:01:00.000Z'),
      operation,
    })
    const serializedApiResponse = JSON.stringify(sealed)
    const opened = await openSealedCredentialLease(sealed, pair.privateKey, {
      operation,
      now: new Date('2026-09-01T20:00:10.000Z'),
    })

    const page = loginPage()
    page.window.document.querySelector('#btn-login')?.addEventListener('click', (event) => {
      event.preventDefault()
    })
    const acknowledgement = submitNationalLifeCredential(
      page.window.document,
      page.window.location.href,
      opened,
    )
    const extensionStorage = {
      credentialAttempt: {
        operationKind: operation.kind,
        operationId: operation.id,
        authEpoch: operation.authEpoch,
        leaseId: sealed.leaseId,
        attemptedAt: '2026-09-01T20:00:05.000Z',
      },
    }

    expect(vaultEncryptRequests).toEqual([{
      plaintext: { formatVersion: 1, username, password },
      binding: {
        agentId: 'agent_1', formatVersion: 1, provider: 'NATIONAL_LIFE',
        purpose: 'PORTAL_CREDENTIAL',
      },
    }])
    expect(page.window.document.querySelector<HTMLInputElement>('#email')?.value).toBe(username)
    expect(page.window.document.querySelector<HTMLInputElement>('#password')?.value).toBe(password)
    expect(acknowledgement).toEqual({ ok: true, code: 'SUBMITTED' })

    const forbiddenSurfaces = JSON.stringify({
      persisted,
      audits,
      notifications,
      commandEvents,
      serializedApiResponse,
      extensionStorage,
      acknowledgement,
      logs,
      caughtErrors,
    })
    expect(forbiddenSurfaces).not.toContain(username)
    expect(forbiddenSurfaces).not.toContain(password)
    expect(persisted[0]).toMatchObject({
      maskedUsername: 'cr***2d',
      encryptedPayload: 'vault:v7:Y2lwaGVydGV4dC1vbmx5',
      encryptionProvider: 'VAULT_TRANSIT',
    })
    expect(serializedApiResponse).not.toMatch(/username|password/i)
    expect(JSON.stringify(extensionStorage)).not.toMatch(/wrappedKey|ciphertext|"iv"/)
  })

  it('keeps generated user-facing failures free of credential markers', () => {
    const failures = [
      new Error('CREDENTIAL_BROKER_UNAVAILABLE'),
      new Error('CREDENTIAL_LEASE_ALREADY_ISSUED'),
      new Error('MFA_REQUIRED'),
      new Error('CREDENTIAL_REJECTED'),
    ]
    expect(JSON.stringify(failures.map((error) => error.message))).not.toContain(username)
    expect(JSON.stringify(failures.map((error) => error.message))).not.toContain(password)
    expect(vi.isMockFunction(console.error)).toBe(false)
  })
})
