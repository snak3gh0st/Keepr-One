import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getKBotCredentialWebConfig } from './config'
import type { CredentialEncryptPort } from './vault-transit'
import { createVaultTransitEncryptClient } from './vault-transit'

const PROVIDER = 'NATIONAL_LIFE' as const

export type NationalLifeCredentialStatus =
  | 'NOT_CONFIGURED'
  | 'UNTESTED'
  | 'READY'
  | 'REJECTED'
  | 'REVOKED'

export type NationalLifeCredentialSummary = Readonly<{
  configured: boolean
  autoLoginEnabled: boolean
  status: NationalLifeCredentialStatus
  maskedUsername: string | null
  consentedAt: string | null
  lastSucceededAt: string | null
  lastRejectedAt: string | null
}>

export type CredentialRecord = Readonly<{
  id: string
  agentId: string
  provider: typeof PROVIDER
  maskedUsername: string
  encryptionProvider: string
  formatVersion: number
  keyVersion: string | null
  encryptedPayload: string | null
  autoLoginEnabled: boolean
  status: string
  consentedAt: Date | null
  lastSucceededAt: Date | null
  lastRejectedAt: Date | null
  revokedAt: Date | null
}>

export type CredentialUpsertInput = Omit<CredentialRecord, 'id'>

export type CredentialAuditInput = Readonly<{
  userId: string
  action: 'NATIONAL_LIFE_CREDENTIAL_SAVED' | 'NATIONAL_LIFE_CREDENTIAL_REVOKED'
  entity: 'AgentIntegrationCredential'
  entityId: string
  before: Readonly<{
    autoLoginEnabled: boolean
    encryptionProvider: string
    status: string
  }> | null
  after: Readonly<{
    autoLoginEnabled: boolean
    encryptionProvider: string
    status: string
  }>
}>

export interface CredentialRepository {
  findByAgentProvider(agentId: string, provider: typeof PROVIDER): Promise<CredentialRecord | null>
  upsert(input: CredentialUpsertInput): Promise<CredentialRecord>
  revoke(input: {
    agentId: string
    provider: typeof PROVIDER
    revokedAt: Date
  }): Promise<CredentialRecord | null>
}

export interface CredentialAuditRepository {
  create(input: CredentialAuditInput): Promise<void>
}

export interface CredentialSettingsPersistence {
  credential: CredentialRepository
  transaction<T>(work: (repositories: {
    credential: CredentialRepository
    audit: CredentialAuditRepository
  }) => Promise<T>): Promise<T>
}

export type CredentialSettingsErrorCode =
  | 'CREDENTIAL_FEATURE_DISABLED'
  | 'CREDENTIAL_NOT_CONFIGURED'

export class CredentialSettingsError extends Error {
  constructor(readonly code: CredentialSettingsErrorCode) {
    super(code)
    this.name = 'CredentialSettingsError'
  }
}

type CredentialSettingsServiceDependencies = Readonly<{
  persistence: CredentialSettingsPersistence
  encryptPort: CredentialEncryptPort
  now?: () => Date
}>

function safeAuditState(record: CredentialRecord | null) {
  return record ? {
    autoLoginEnabled: record.autoLoginEnabled,
    encryptionProvider: record.encryptionProvider,
    status: record.status,
  } : null
}

function maskUsername(username: string) {
  const value = username.trim()
  if (value.length === 1) return `${value}***`
  if (value.length <= 4) return `${value[0]}***${value.at(-1)}`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

function safeStatus(value: string): Exclude<NationalLifeCredentialStatus, 'NOT_CONFIGURED'> {
  return ['UNTESTED', 'READY', 'REJECTED', 'REVOKED'].includes(value)
    ? value as Exclude<NationalLifeCredentialStatus, 'NOT_CONFIGURED'>
    : 'UNTESTED'
}

function summary(record: CredentialRecord | null): NationalLifeCredentialSummary {
  if (!record) {
    return {
      configured: false,
      autoLoginEnabled: false,
      status: 'NOT_CONFIGURED',
      maskedUsername: null,
      consentedAt: null,
      lastSucceededAt: null,
      lastRejectedAt: null,
    }
  }
  const status = safeStatus(record.status)
  return {
    configured: Boolean(record.encryptedPayload) && status !== 'REVOKED',
    autoLoginEnabled: record.autoLoginEnabled,
    status,
    maskedUsername: record.maskedUsername,
    consentedAt: record.consentedAt?.toISOString() ?? null,
    lastSucceededAt: record.lastSucceededAt?.toISOString() ?? null,
    lastRejectedAt: record.lastRejectedAt?.toISOString() ?? null,
  }
}

export function createCredentialSettingsService(deps: CredentialSettingsServiceDependencies) {
  return {
    async getSummary(agentId: string) {
      return summary(await deps.persistence.credential.findByAgentProvider(agentId, PROVIDER))
    },

    async save(input: {
      agentId: string
      userId: string
      username: string
      password: string
    }) {
      const encrypted = await deps.encryptPort.encrypt({
        plaintext: {
          formatVersion: 1,
          username: input.username,
          password: input.password,
        },
        binding: {
          agentId: input.agentId,
          formatVersion: 1,
          provider: PROVIDER,
          purpose: 'PORTAL_CREDENTIAL',
        },
      })
      const consentedAt = (deps.now ?? (() => new Date()))()

      return deps.persistence.transaction(async ({ credential, audit }) => {
        const before = await credential.findByAgentProvider(input.agentId, PROVIDER)
        const saved = await credential.upsert({
          agentId: input.agentId,
          provider: PROVIDER,
          maskedUsername: maskUsername(input.username),
          encryptionProvider: encrypted.encryptionProvider,
          formatVersion: encrypted.formatVersion,
          keyVersion: encrypted.keyVersion,
          encryptedPayload: encrypted.encryptedPayload,
          autoLoginEnabled: true,
          status: 'UNTESTED',
          consentedAt,
          lastSucceededAt: null,
          lastRejectedAt: null,
          revokedAt: null,
        })
        await audit.create({
          userId: input.userId,
          action: 'NATIONAL_LIFE_CREDENTIAL_SAVED',
          entity: 'AgentIntegrationCredential',
          entityId: saved.id,
          before: safeAuditState(before),
          after: safeAuditState(saved)!,
        })
        return summary(saved)
      })
    },

    async revoke(input: { agentId: string; userId: string }) {
      const revokedAt = (deps.now ?? (() => new Date()))()
      return deps.persistence.transaction(async ({ credential, audit }) => {
        const before = await credential.findByAgentProvider(input.agentId, PROVIDER)
        if (!before) throw new CredentialSettingsError('CREDENTIAL_NOT_CONFIGURED')
        const revoked = await credential.revoke({
          agentId: input.agentId,
          provider: PROVIDER,
          revokedAt,
        })
        if (!revoked) throw new CredentialSettingsError('CREDENTIAL_NOT_CONFIGURED')
        await audit.create({
          userId: input.userId,
          action: 'NATIONAL_LIFE_CREDENTIAL_REVOKED',
          entity: 'AgentIntegrationCredential',
          entityId: revoked.id,
          before: safeAuditState(before),
          after: safeAuditState(revoked)!,
        })
        return summary(revoked)
      })
    },
  }
}

function mapRecord(record: {
  id: string
  agentId: string
  provider: string
  maskedUsername: string
  encryptionProvider: string
  formatVersion: number
  keyVersion: string | null
  encryptedPayload: string | null
  autoLoginEnabled: boolean
  status: string
  consentedAt: Date | null
  lastSucceededAt: Date | null
  lastRejectedAt: Date | null
  revokedAt: Date | null
} | null): CredentialRecord | null {
  if (!record || record.provider !== PROVIDER) return null
  return { ...record, provider: PROVIDER }
}

function credentialRepository(client: Prisma.TransactionClient | typeof prisma): CredentialRepository {
  return {
    async findByAgentProvider(agentId, provider) {
      return mapRecord(await client.agentIntegrationCredential.findUnique({
        where: { agentId_provider: { agentId, provider } },
      }))
    },
    async upsert(input) {
      const data = {
        maskedUsername: input.maskedUsername,
        keyVersion: input.keyVersion,
        algorithm: null,
        iv: null,
        ciphertext: null,
        authTag: null,
        formatVersion: input.formatVersion,
        encryptionProvider: input.encryptionProvider,
        encryptedPayload: input.encryptedPayload,
        autoLoginEnabled: input.autoLoginEnabled,
        status: input.status,
        consentedAt: input.consentedAt,
        lastLeasedAt: null,
        lastTestedAt: null,
        lastSucceededAt: input.lastSucceededAt,
        lastRejectedAt: input.lastRejectedAt,
        revokedAt: input.revokedAt,
      }
      const saved = await client.agentIntegrationCredential.upsert({
        where: { agentId_provider: { agentId: input.agentId, provider: input.provider } },
        create: { agentId: input.agentId, provider: input.provider, ...data },
        update: data,
      })
      return mapRecord(saved)!
    },
    async revoke(input) {
      const existing = await client.agentIntegrationCredential.findUnique({
        where: { agentId_provider: { agentId: input.agentId, provider: input.provider } },
      })
      if (!existing) return null
      const revoked = await client.agentIntegrationCredential.update({
        where: { agentId_provider: { agentId: input.agentId, provider: input.provider } },
        data: {
          keyVersion: null,
          encryptedPayload: null,
          autoLoginEnabled: false,
          status: 'REVOKED',
          revokedAt: input.revokedAt,
        },
      })
      return mapRecord(revoked)
    },
  }
}

function auditRepository(client: Prisma.TransactionClient): CredentialAuditRepository {
  return {
    async create(input) {
      await client.auditLog.create({
        data: {
          userId: input.userId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          before: input.before === null
            ? Prisma.JsonNull
            : input.before as Prisma.InputJsonValue,
          after: input.after as Prisma.InputJsonValue,
        },
      })
    },
  }
}

const productionPersistence: CredentialSettingsPersistence = {
  credential: credentialRepository(prisma),
  transaction(work) {
    return prisma.$transaction((transaction) => work({
      credential: credentialRepository(transaction),
      audit: auditRepository(transaction),
    }))
  },
}

function productionService() {
  const config = getKBotCredentialWebConfig()
  if (!config.enabled || !config.vault) {
    throw new CredentialSettingsError('CREDENTIAL_FEATURE_DISABLED')
  }
  return createCredentialSettingsService({
    persistence: productionPersistence,
    encryptPort: createVaultTransitEncryptClient(config.vault),
  })
}

export async function getNationalLifeCredentialSummary(agentId: string) {
  return summary(await productionPersistence.credential.findByAgentProvider(agentId, PROVIDER))
}

export async function saveNationalLifeCredential(input: {
  agentId: string
  userId: string
  username: string
  password: string
}) {
  return productionService().save(input)
}

export async function revokeNationalLifeCredential(input: {
  agentId: string
  userId: string
}) {
  return productionService().revoke(input)
}
