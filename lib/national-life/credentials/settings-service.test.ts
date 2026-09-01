import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CredentialSettingsError,
  createCredentialSettingsService,
  type CredentialAuditRepository,
  type CredentialRecord,
  type CredentialRepository,
  type CredentialSettingsPersistence,
  type CredentialUpsertInput,
} from './settings-service'

const now = new Date('2026-09-01T18:00:00.000Z')

function harness(initial: CredentialRecord | null = null) {
  let record = initial
  const repository: CredentialRepository = {
    findByAgentProvider: vi.fn(async (agentId, provider) => {
      if (!record || record.agentId !== agentId || record.provider !== provider) return null
      return record
    }),
    upsert: vi.fn(async (input: CredentialUpsertInput): Promise<CredentialRecord> => {
      const previous = record
      const saved: CredentialRecord = {
        id: previous?.id ?? 'credential-1',
        ...input,
      }
      record = saved
      return saved
    }),
    revoke: vi.fn(async (input) => {
      if (!record || record.agentId !== input.agentId || record.provider !== input.provider) {
        return null
      }
      record = {
        ...record,
        encryptedPayload: null,
        autoLoginEnabled: false,
        status: 'REVOKED',
        revokedAt: input.revokedAt,
      }
      return record
    }),
  }
  const audit: CredentialAuditRepository = {
    create: vi.fn(async () => undefined),
  }
  const persistence: CredentialSettingsPersistence = {
    credential: repository,
    transaction: vi.fn(async (work) => work({ credential: repository, audit })),
  }
  const encryptPort = {
    encrypt: vi.fn(async () => ({
      encryptionProvider: 'VAULT_TRANSIT' as const,
      formatVersion: 1 as const,
      keyVersion: 'v7',
      encryptedPayload: 'vault:v7:ciphertext',
    })),
  }
  const service = createCredentialSettingsService({
    persistence,
    encryptPort,
    now: () => now,
  })
  return { service, repository, audit, persistence, encryptPort, read: () => record }
}

describe('National Life credential settings service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('encrypts and persists only Vault ciphertext plus masked metadata', async () => {
    const { service, repository, audit, encryptPort } = harness()

    const summary = await service.save({
      agentId: 'agent-1',
      userId: 'user-1',
      username: 'agent123',
      password: 'sentinel-password',
    })

    expect(encryptPort.encrypt).toHaveBeenCalledWith({
      plaintext: { formatVersion: 1, username: 'agent123', password: 'sentinel-password' },
      binding: {
        agentId: 'agent-1', formatVersion: 1, provider: 'NATIONAL_LIFE',
        purpose: 'PORTAL_CREDENTIAL',
      },
    })
    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      provider: 'NATIONAL_LIFE',
      encryptedPayload: 'vault:v7:ciphertext',
      maskedUsername: 'ag***23',
      autoLoginEnabled: true,
      status: 'UNTESTED',
    }))
    expect(JSON.stringify(vi.mocked(repository.upsert).mock.calls)).not.toContain('sentinel-password')
    expect(JSON.stringify(vi.mocked(repository.upsert).mock.calls)).not.toContain('"username"')
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'NATIONAL_LIFE_CREDENTIAL_SAVED',
      after: { autoLoginEnabled: true, encryptionProvider: 'VAULT_TRANSIT', status: 'UNTESTED' },
    }))
    expect(summary).toEqual({
      configured: true,
      autoLoginEnabled: true,
      status: 'UNTESTED',
      maskedUsername: 'ag***23',
      consentedAt: now.toISOString(),
      lastSucceededAt: null,
      lastRejectedAt: null,
    })
  })

  it('replaces a credential without putting old ciphertext in the audit event', async () => {
    const existing: CredentialRecord = {
      id: 'credential-1', agentId: 'agent-1', provider: 'NATIONAL_LIFE',
      maskedUsername: 'ol***er', encryptionProvider: 'VAULT_TRANSIT',
      formatVersion: 1, keyVersion: 'v2', encryptedPayload: 'vault:v2:old-ciphertext',
      autoLoginEnabled: true, status: 'READY', consentedAt: new Date('2026-08-01T00:00:00Z'),
      lastSucceededAt: new Date('2026-08-20T00:00:00Z'), lastRejectedAt: null,
      revokedAt: null,
    }
    const { service, audit } = harness(existing)

    await service.save({
      agentId: 'agent-1', userId: 'user-1', username: 'replacement',
      password: 'sentinel-password',
    })

    const serializedAudit = JSON.stringify(vi.mocked(audit.create).mock.calls)
    expect(serializedAudit).not.toContain('vault:v2:old-ciphertext')
    expect(serializedAudit).not.toContain('sentinel-password')
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      before: { autoLoginEnabled: true, encryptionProvider: 'VAULT_TRANSIT', status: 'READY' },
    }))
  })

  it('revokes by clearing ciphertext and records only safe audit metadata', async () => {
    const existing: CredentialRecord = {
      id: 'credential-1', agentId: 'agent-1', provider: 'NATIONAL_LIFE',
      maskedUsername: 'ag***23', encryptionProvider: 'VAULT_TRANSIT',
      formatVersion: 1, keyVersion: 'v7', encryptedPayload: 'vault:v7:old-ciphertext',
      autoLoginEnabled: true, status: 'READY', consentedAt: now,
      lastSucceededAt: now, lastRejectedAt: null, revokedAt: null,
    }
    const { service, repository, audit, read } = harness(existing)

    const summary = await service.revoke({ agentId: 'agent-1', userId: 'user-1' })

    expect(repository.revoke).toHaveBeenCalledWith({
      agentId: 'agent-1', provider: 'NATIONAL_LIFE', revokedAt: now,
    })
    expect(read()).toMatchObject({
      encryptedPayload: null, autoLoginEnabled: false, status: 'REVOKED',
    })
    expect(JSON.stringify(vi.mocked(audit.create).mock.calls)).not.toContain('vault:v7:old-ciphertext')
    expect(summary).toMatchObject({ configured: false, status: 'REVOKED', autoLoginEnabled: false })
  })

  it('never revokes another agent credential', async () => {
    const otherAgent: CredentialRecord = {
      id: 'credential-2', agentId: 'agent-2', provider: 'NATIONAL_LIFE',
      maskedUsername: 'ot***er', encryptionProvider: 'VAULT_TRANSIT',
      formatVersion: 1, keyVersion: 'v1', encryptedPayload: 'vault:v1:ciphertext',
      autoLoginEnabled: true, status: 'READY', consentedAt: now,
      lastSucceededAt: null, lastRejectedAt: null, revokedAt: null,
    }
    const { service, repository } = harness(otherAgent)

    await expect(service.revoke({ agentId: 'agent-1', userId: 'user-1' }))
      .rejects.toEqual(new CredentialSettingsError('CREDENTIAL_NOT_CONFIGURED'))
    expect(repository.revoke).not.toHaveBeenCalled()
  })
})
