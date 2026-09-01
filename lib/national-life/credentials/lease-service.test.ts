import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredentialLeasePersistence, CredentialLeaseContext } from './lease-service'
import {
  createCredentialLeaseService,
  createPrismaCredentialLeasePersistence,
  CredentialLeaseError,
} from './lease-service'
import { credentialEncryptionKeyThumbprint } from './device-key-service'

const now = new Date('2026-09-01T18:00:00.000Z')
const publicKeyJwk: JsonWebKey = {
  kty: 'RSA',
  alg: 'RSA-OAEP-256',
  use: 'enc',
  key_ops: ['encrypt'],
  ext: true,
  e: 'AQAB',
  n: Buffer.alloc(384, 7).toString('base64url'),
}
const sealed = {
  schemaVersion: 1 as const,
  leaseId: 'lease_1',
  expiresAt: '2026-09-01T18:01:00.000Z',
  operation: { kind: 'SYNC_RUN' as const, id: 'run_1', authEpoch: 1 },
  keyAlgorithm: 'RSA-OAEP-256' as const,
  contentAlgorithm: 'AES-256-GCM' as const,
  wrappedKey: Buffer.alloc(384, 2).toString('base64url'),
  iv: Buffer.alloc(12, 3).toString('base64url'),
  ciphertext: Buffer.alloc(32, 4).toString('base64url'),
}

function context(override: Partial<CredentialLeaseContext> = {}): CredentialLeaseContext {
  return {
    device: {
      id: 'device_1', agentId: 'agent_1', status: 'ACTIVE', revokedAt: null,
      encryptionPublicKeyJwk: publicKeyJwk,
      encryptionKeyThumbprint: credentialEncryptionKeyThumbprint(publicKeyJwk),
    },
    credential: {
      id: 'credential_1', agentId: 'agent_1', provider: 'NATIONAL_LIFE',
      encryptionProvider: 'VAULT_TRANSIT', formatVersion: 1, keyVersion: 'v1',
      encryptedPayload: 'vault:v1:ciphertext', autoLoginEnabled: true,
      status: 'READY', revokedAt: null,
    },
    operation: {
      kind: 'SYNC_RUN', id: 'run_1', agentId: 'agent_1', deviceId: 'device_1',
      state: 'RUNNING', authState: 'AUTH_REQUIRED', authEpoch: 1,
      authRequiredAt: new Date(now.getTime() - 10_000), expiresAt: null,
      latestEventType: null,
    },
    existingLease: false,
    ...override,
  }
}

function harness(options: {
  context?: CredentialLeaseContext
  enabled?: boolean
  allowAgent?: boolean
  limit?: { allowed: true } | { allowed: false; code: 'CREDENTIAL_RATE_LIMITED'; retryAfterSeconds: number } | { allowed: false; code: 'CREDENTIAL_LIMIT_UNAVAILABLE' }
} = {}) {
  const events: string[] = []
  const current = options.context ?? context()
  const reserveLease = vi.fn(async () => {
    events.push('lease-created')
    return true
  })
  const markDeliveryFailed = vi.fn(async () => undefined)
  const commitOutcome = vi.fn(async () => true)
  const persistence: CredentialLeasePersistence = {
    loadIssueContext: vi.fn(async () => current),
    reserveLease,
    markDeliveryFailed,
    loadResultLease: vi.fn(async () => ({
      id: 'lease_1', agentId: 'agent_1', deviceId: 'device_1', credentialId: 'credential_1',
      operationKind: 'SYNC_RUN', operationId: 'run_1', authEpoch: 1,
      status: 'ISSUED', reportedAt: null,
    })),
    commitOutcome,
  }
  const decrypt = vi.fn(async () => {
    events.push('vault-decrypt')
    return { formatVersion: 1 as const, username: 'sentinel-user', password: 'sentinel-pass' }
  })
  const seal = vi.fn(async () => {
    events.push('device-seal')
    return sealed
  })
  const limiter = vi.fn(async () => options.limit ?? { allowed: true as const })
  const service = createCredentialLeaseService({
    persistence,
    decryptPort: { decrypt },
    seal,
    limiter,
    rollout: {
      enabled: options.enabled ?? true,
      autoLoginAllAgents: false,
      autoLoginAgentIds: new Set(options.allowAgent === false ? [] : ['agent_1']),
    },
    now: () => now,
    createLeaseId: () => 'lease_1',
  })
  return { service, persistence, reserveLease, markDeliveryFailed, commitOutcome, decrypt, seal, limiter, events }
}

const request = {
  schemaVersion: 1 as const,
  operation: { kind: 'SYNC_RUN' as const, id: 'run_1' },
  page: {
    origin: 'https://nlg-prod.auth0.com' as const,
    pathname: '/login',
    classification: 'LOGIN' as const,
  },
}

async function issue(service: ReturnType<typeof harness>['service'], candidate: unknown = request) {
  return service.issueCredentialLease({
    agentId: 'agent_1', deviceId: 'device_1', request: candidate,
  })
}

describe('credential lease service', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ['disabled rollout', { enabled: false }, 'CREDENTIAL_FEATURE_DISABLED'],
    ['agent outside allowlist', { allowAgent: false }, 'CREDENTIAL_AGENT_NOT_ALLOWED'],
    ['revoked device', { context: context({ device: { ...context().device!, status: 'REVOKED' } }) }, 'CREDENTIAL_DEVICE_NOT_ACTIVE'],
    ['wrong device owner', { context: context({ device: { ...context().device!, agentId: 'agent_2' } }) }, 'CREDENTIAL_DEVICE_NOT_ACTIVE'],
    ['missing device key', { context: context({ device: { ...context().device!, encryptionPublicKeyJwk: null } }) }, 'DEVICE_ENCRYPTION_KEY_REQUIRED'],
    ['device key conflict', { context: context({ device: { ...context().device!, encryptionKeyThumbprint: 'different' } }) }, 'CREDENTIAL_DEVICE_KEY_CONFLICT'],
    ['missing credential', { context: context({ credential: null }) }, 'CREDENTIAL_NOT_CONFIGURED'],
    ['rejected credential', { context: context({ credential: { ...context().credential!, status: 'REJECTED' } }) }, 'CREDENTIAL_AUTO_LOGIN_DISABLED'],
    ['disabled credential', { context: context({ credential: { ...context().credential!, autoLoginEnabled: false } }) }, 'CREDENTIAL_AUTO_LOGIN_DISABLED'],
    ['wrong operation owner', { context: context({ operation: { ...context().operation!, agentId: 'agent_2' } }) }, 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'],
    ['wrong operation device', { context: context({ operation: { ...context().operation!, deviceId: 'device_2' } }) }, 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'],
    ['operation not running', { context: context({ operation: { ...context().operation!, state: 'FAILED' } }) }, 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'],
    ['operation not waiting for auth', { context: context({ operation: { ...context().operation!, authState: 'READY' } }) }, 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'],
    ['operation waiting for MFA', { context: context({ operation: { ...context().operation!, authState: 'MFA_REQUIRED', latestEventType: 'MFA_REQUIRED' } }) }, 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'],
    ['expired auth episode', { context: context({ operation: { ...context().operation!, authRequiredAt: new Date(now.getTime() - 301_000) } }) }, 'CREDENTIAL_AUTH_STATE_EXPIRED'],
    ['existing epoch lease', { context: context({ existingLease: true }) }, 'CREDENTIAL_LEASE_ALREADY_ISSUED'],
    ['rate limited', { limit: { allowed: false, code: 'CREDENTIAL_RATE_LIMITED', retryAfterSeconds: 42 } }, 'CREDENTIAL_RATE_LIMITED'],
    ['limiter unavailable', { limit: { allowed: false, code: 'CREDENTIAL_LIMIT_UNAVAILABLE' } }, 'CREDENTIAL_LIMIT_UNAVAILABLE'],
  ] as const)('refuses %s before decrypting', async (_label, options, code) => {
    const test = harness(options)
    await expect(issue(test.service)).rejects.toMatchObject({ code } satisfies Partial<CredentialLeaseError>)
    expect(test.decrypt).not.toHaveBeenCalled()
  })

  it.each([
    { ...request, page: { ...request.page, pathname: '/agent/book-of-business' } },
    { ...request, page: { ...request.page, pathname: '/authorize' } },
    { ...request, page: { ...request.page, classification: 'MFA' as never } },
  ])('refuses an unapproved page contract before decrypting', async (candidate) => {
    const test = harness()
    await expect(issue(test.service, candidate as typeof request)).rejects.toMatchObject({
      code: 'CREDENTIAL_PAGE_NOT_APPROVED',
    })
    expect(test.decrypt).not.toHaveBeenCalled()
  })

  it('requires an unexpired command in AUTH_REQUIRED with no latest MFA event', async () => {
    const commandRequest = {
      ...request,
      operation: { kind: 'CONNECTOR_COMMAND' as const, id: 'command_1' },
    }
    const commandOperation = {
      ...context().operation!,
      kind: 'CONNECTOR_COMMAND' as const,
      id: 'command_1',
      state: 'AUTH_REQUIRED',
      expiresAt: new Date(now.getTime() + 60_000),
      latestEventType: 'AUTH_REQUIRED',
    }
    const valid = harness({ context: context({ operation: commandOperation }) })
    await issue(valid.service, commandRequest)
    expect(valid.seal).toHaveBeenCalledWith(expect.objectContaining({
      operation: { kind: 'CONNECTOR_COMMAND', id: 'command_1', authEpoch: 1 },
    }))

    const expired = harness({
      context: context({
        operation: { ...commandOperation, expiresAt: new Date(now.getTime() - 1) },
      }),
    })
    await expect(issue(expired.service, commandRequest)).rejects.toMatchObject({
      code: 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED',
    })
    expect(expired.decrypt).not.toHaveBeenCalled()

    const mfa = harness({
      context: context({
        operation: { ...commandOperation, authState: 'MFA_REQUIRED', latestEventType: 'MFA_REQUIRED' },
      }),
    })
    await expect(issue(mfa.service, commandRequest)).rejects.toMatchObject({
      code: 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED',
    })
    expect(mfa.decrypt).not.toHaveBeenCalled()
  })

  it('durably reserves once before decrypting and returns only the sealed contract', async () => {
    const test = harness()
    const result = await issue(test.service)

    expect(result).toEqual(sealed)
    expect(test.events).toEqual(['lease-created', 'vault-decrypt', 'device-seal'])
    expect(test.reserveLease).toHaveBeenCalledWith(expect.objectContaining({
      leaseId: 'lease_1', credentialId: 'credential_1', authEpoch: 1,
      lastLeasedAt: now,
    }))
    expect(JSON.stringify(test.reserveLease.mock.calls)).not.toMatch(/sentinel-user|sentinel-pass/)
    expect(JSON.stringify(result)).not.toMatch(/username|password|sentinel/)
  })

  it('marks a reserved lease failed when Vault or device sealing fails', async () => {
    const test = harness()
    test.decrypt.mockRejectedValueOnce(new Error('provider detail'))

    await expect(issue(test.service)).rejects.toMatchObject({ code: 'CREDENTIAL_DELIVERY_FAILED' })
    expect(test.markDeliveryFailed).toHaveBeenCalledWith({
      leaseId: 'lease_1', outcome: 'DELIVERY_FAILED', now,
    })
  })

  it.each(['AUTHENTICATED', 'MFA_REQUIRED', 'REJECTED', 'UNKNOWN_PAGE'] as const)(
    'records %s exactly once with only safe metadata',
    async (outcome) => {
      const test = harness()
      await expect(test.service.recordCredentialLeaseOutcome({
        agentId: 'agent_1', deviceId: 'device_1', leaseId: 'lease_1',
        result: { schemaVersion: 1, outcome },
      })).resolves.toEqual({ leaseId: 'lease_1', outcome })
      expect(test.commitOutcome).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent_1', deviceId: 'device_1', leaseId: 'lease_1', outcome, now,
      }))
      expect(JSON.stringify(test.commitOutcome.mock.calls)).not.toMatch(/username|password|cookie|token/i)
    },
  )

  it('rejects a result from another device or a second result', async () => {
    const wrongDevice = harness()
    await expect(wrongDevice.service.recordCredentialLeaseOutcome({
      agentId: 'agent_1', deviceId: 'device_2', leaseId: 'lease_1',
      result: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    })).rejects.toMatchObject({ code: 'CREDENTIAL_LEASE_NOT_ACTIVE' })

    const duplicate = harness()
    duplicate.commitOutcome.mockResolvedValueOnce(false)
    await expect(duplicate.service.recordCredentialLeaseOutcome({
      agentId: 'agent_1', deviceId: 'device_1', leaseId: 'lease_1',
      result: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    })).rejects.toMatchObject({ code: 'CREDENTIAL_LEASE_ALREADY_REPORTED' })
  })

  it('persists safe credential and MFA outcome effects atomically', async () => {
    const credentialUpdate = vi.fn().mockResolvedValue({ count: 1 })
    const notificationUpsert = vi.fn().mockResolvedValue({ id: 'notification_1' })
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit_1' })
    const tx = {
      nationalLifeCredentialLease: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lease_1', credentialId: 'credential_1', operationKind: 'SYNC_RUN',
          operationId: 'run_1', authEpoch: 1, agent: { userId: 'user_1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      agentIntegrationCredential: { updateMany: credentialUpdate },
      notification: { upsert: notificationUpsert },
      auditLog: { create: auditCreate },
    }
    const persistence = createPrismaCredentialLeasePersistence({
      $transaction: (work: (client: typeof tx) => unknown) => work(tx),
    } as never)

    await expect(persistence.commitOutcome({
      agentId: 'agent_1', deviceId: 'device_1', leaseId: 'lease_1',
      outcome: 'MFA_REQUIRED', now,
    })).resolves.toBe(true)

    expect(credentialUpdate).not.toHaveBeenCalled()
    expect(notificationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupeKey: 'national-life-mfa-required:run_1:1' },
      create: expect.objectContaining({
        recipientUserId: 'user_1', type: 'NATIONAL_LIFE_MFA_REQUIRED',
      }),
    }))
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1',
        action: 'NATIONAL_LIFE_CREDENTIAL_LEASE_RESULT',
        after: expect.objectContaining({ outcome: 'MFA_REQUIRED', authEpoch: 1 }),
      }),
    })
    expect(JSON.stringify({
      notifications: notificationUpsert.mock.calls,
      audits: auditCreate.mock.calls,
    })).not.toMatch(/username|password|cookie|token/i)
  })
})
