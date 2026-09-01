import { describe, expect, it, vi } from 'vitest'
import { openSealedCredentialLease } from '../../apps/keeprone-connect/lib/credential-envelope'
import {
  createCredentialLeaseService,
  type CredentialLeasePersistence,
} from '../../lib/national-life/credentials/lease-service'
import { sealCredentialForDevice } from '../../lib/national-life/credentials/sealed-envelope'
import { credentialEncryptionKeyThumbprint } from '../../lib/national-life/credentials/device-key-service'
import { createKBotCredentialBrokerHandler } from '../../workers/kbot-credential-broker/runtime'

const leasePath = '/api/agent/integrations/national-life/local-connector/credential-leases'
const now = new Date('2026-09-01T20:00:00.000Z')

async function harness(options: { enabled?: boolean; deviceStatus?: string } = {}) {
  const pair = await crypto.subtle.generateKey({
    name: 'RSA-OAEP', modulusLength: 3072,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, false, ['encrypt', 'decrypt']) as CryptoKeyPair
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicKeyJwk: JsonWebKey = {
    kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    e: exported.e, n: exported.n,
  }
  let reserved = false
  let reported = false
  const outcomes: string[] = []
  const persistence: CredentialLeasePersistence = {
    async loadIssueContext() {
      return {
        device: {
          id: 'device_1', agentId: 'agent_1', status: options.deviceStatus ?? 'ACTIVE',
          revokedAt: null, encryptionPublicKeyJwk: publicKeyJwk,
          encryptionKeyThumbprint: credentialEncryptionKeyThumbprint(publicKeyJwk),
        },
        credential: {
          id: 'credential_1', agentId: 'agent_1', provider: 'NATIONAL_LIFE',
          encryptionProvider: 'VAULT_TRANSIT', formatVersion: 1, keyVersion: 'v7',
          encryptedPayload: 'vault:v7:Y2lwaGVydGV4dA==', autoLoginEnabled: true,
          status: 'READY', revokedAt: null,
        },
        operation: {
          kind: 'SYNC_RUN', id: 'run_1', agentId: 'agent_1', deviceId: 'device_1',
          state: 'RUNNING', authState: 'AUTH_REQUIRED', authEpoch: 1,
          authRequiredAt: new Date(now.getTime() - 5_000), expiresAt: null,
          latestEventType: null,
        },
        existingLease: reserved,
      }
    },
    async reserveLease() {
      if (reserved) return false
      reserved = true
      return true
    },
    async markDeliveryFailed() { reported = true },
    async loadResultLease(input) {
      if (!reserved || input.leaseId !== 'lease_1') return null
      return {
        id: 'lease_1', agentId: 'agent_1', deviceId: 'device_1',
        credentialId: 'credential_1', operationKind: 'SYNC_RUN', operationId: 'run_1',
        authEpoch: 1, status: reported ? 'COMPLETED' : 'ISSUED',
        reportedAt: reported ? now : null,
      }
    },
    async commitOutcome(input) {
      if (reported) return false
      reported = true
      outcomes.push(input.outcome)
      return true
    },
  }
  const decrypt = vi.fn(async () => ({
    formatVersion: 1 as const,
    username: 'synthetic-user',
    password: 'synthetic-password',
  }))
  const service = createCredentialLeaseService({
    persistence,
    decryptPort: { decrypt },
    rollout: {
      enabled: options.enabled ?? true,
      autoLoginAgentIds: new Set(['agent_1']),
      autoLoginAllAgents: false,
    },
    limiter: async () => ({ allowed: true }),
    seal: sealCredentialForDevice,
    now: () => now,
    createLeaseId: () => 'lease_1',
  })
  const handler = createKBotCredentialBrokerHandler({
    async verifyDevice() {
      return { agentId: 'agent_1', deviceId: 'device_1', jti: crypto.randomUUID() }
    },
    issueCredentialLease: (input) => service.issueCredentialLease(input),
    recordCredentialLeaseOutcome: (input) => service.recordCredentialLeaseOutcome(input),
  })
  return { handler, pair, decrypt, outcomes }
}

function request(operation = { kind: 'SYNC_RUN', id: 'run_1' }) {
  return new Request(`http://broker${leasePath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      operation,
      page: {
        origin: 'https://nlg-prod.auth0.com', pathname: '/login', classification: 'LOGIN',
      },
    }),
  })
}

describe('K-Bot credential broker synthetic recovery', () => {
  it.each(['AUTHENTICATED', 'MFA_REQUIRED', 'REJECTED', 'UNKNOWN_PAGE'] as const)(
    'issues one device-bound envelope and commits the safe %s outcome once',
    async (outcome) => {
      const test = await harness()
      const issued = await test.handler(request())
      expect(issued.status).toBe(200)
      expect(issued.headers.get('cache-control')).toBe('no-store')
      const envelope = await issued.json()
      await expect(openSealedCredentialLease(envelope, test.pair.privateKey, {
        operation: { kind: 'SYNC_RUN', id: 'run_1', authEpoch: 1 },
        now: new Date(now.getTime() + 1_000),
      })).resolves.toEqual({
        formatVersion: 1, username: 'synthetic-user', password: 'synthetic-password',
      })

      const duplicate = await test.handler(request())
      expect(duplicate.status).toBe(409)
      expect(await duplicate.json()).toEqual({ error: 'CREDENTIAL_LEASE_ALREADY_ISSUED' })

      const result = await test.handler(new Request(`http://broker${leasePath}/lease_1/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, outcome }),
      }))
      expect(result.status).toBe(200)
      expect(test.outcomes).toEqual([outcome])

      const repeated = await test.handler(new Request(`http://broker${leasePath}/lease_1/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, outcome }),
      }))
      expect(repeated.status).toBe(409)
      expect(test.outcomes).toEqual([outcome])
    },
  )

  it.each([
    ['feature kill switch', { enabled: false }],
    ['revoked device', { deviceStatus: 'REVOKED' }],
  ] as const)('delivers no plaintext for %s', async (_label, options) => {
    const test = await harness(options)
    const response = await test.handler(request())
    expect(response.status).toBe('enabled' in options && options.enabled === false ? 503 : 409)
    expect(test.decrypt).not.toHaveBeenCalled()
  })
})
