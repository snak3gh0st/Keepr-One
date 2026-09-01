import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  parseCredentialLeaseRequest,
  parseCredentialLeaseResult,
  type CredentialLeaseOutcome,
  type CredentialLeaseRequestV1,
  type SealedCredentialLeaseV1,
} from './contracts'
import { credentialEncryptionKeyThumbprint } from './device-key-service'
import type { CredentialDecryptPort } from './vault-transit'
import { sealCredentialForDevice } from './sealed-envelope'
import {
  consumeCredentialLeaseLimit,
  type CredentialLeaseLimitResult,
} from './rate-limit'

const AUTH_STATE_MAX_AGE_MS = 5 * 60_000
const LEASE_LIFETIME_MS = 60_000

type DeviceContext = Readonly<{
  id: string
  agentId: string
  status: string
  revokedAt: Date | null
  encryptionPublicKeyJwk: unknown | null
  encryptionKeyThumbprint: string | null
}>

type CredentialContext = Readonly<{
  id: string
  agentId: string
  provider: string
  encryptionProvider: string
  formatVersion: number
  keyVersion: string | null
  encryptedPayload: string | null
  autoLoginEnabled: boolean
  status: string
  revokedAt: Date | null
}>

type OperationContext = Readonly<{
  kind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
  id: string
  agentId: string
  deviceId: string | null
  state: string
  authState: string
  authEpoch: number
  authRequiredAt: Date | null
  expiresAt: Date | null
  latestEventType: string | null
}>

export type CredentialLeaseContext = Readonly<{
  device: DeviceContext | null
  credential: CredentialContext | null
  operation: OperationContext | null
  existingLease: boolean
}>

export type CredentialLeaseResultRecord = Readonly<{
  id: string
  agentId: string
  deviceId: string
  credentialId: string
  operationKind: string
  operationId: string
  authEpoch: number
  status: string
  reportedAt: Date | null
}>

export interface CredentialLeasePersistence {
  loadIssueContext(input: {
    agentId: string
    deviceId: string
    operation: CredentialLeaseRequestV1['operation']
  }): Promise<CredentialLeaseContext>
  reserveLease(input: {
    leaseId: string
    agentId: string
    credentialId: string
    deviceId: string
    operationKind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
    operationId: string
    authEpoch: number
    deviceKeyThumbprint: string
    issuedAt: Date
    expiresAt: Date
    lastLeasedAt: Date
  }): Promise<boolean>
  markDeliveryFailed(input: {
    leaseId: string
    outcome: 'DELIVERY_FAILED'
    now: Date
  }): Promise<void>
  loadResultLease(input: {
    agentId: string
    deviceId: string
    leaseId: string
  }): Promise<CredentialLeaseResultRecord | null>
  commitOutcome(input: {
    agentId: string
    deviceId: string
    leaseId: string
    outcome: CredentialLeaseOutcome
    now: Date
  }): Promise<boolean>
}

export type CredentialLeaseErrorCode =
  | 'CREDENTIAL_FEATURE_DISABLED'
  | 'CREDENTIAL_AGENT_NOT_ALLOWED'
  | 'CREDENTIAL_DEVICE_NOT_ACTIVE'
  | 'DEVICE_ENCRYPTION_KEY_REQUIRED'
  | 'CREDENTIAL_DEVICE_KEY_CONFLICT'
  | 'CREDENTIAL_NOT_CONFIGURED'
  | 'CREDENTIAL_AUTO_LOGIN_DISABLED'
  | 'CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED'
  | 'CREDENTIAL_AUTH_STATE_EXPIRED'
  | 'CREDENTIAL_PAGE_NOT_APPROVED'
  | 'CREDENTIAL_LEASE_ALREADY_ISSUED'
  | 'CREDENTIAL_RATE_LIMITED'
  | 'CREDENTIAL_LIMIT_UNAVAILABLE'
  | 'CREDENTIAL_DELIVERY_FAILED'
  | 'CREDENTIAL_LEASE_NOT_ACTIVE'
  | 'CREDENTIAL_LEASE_ALREADY_REPORTED'

export class CredentialLeaseError extends Error {
  constructor(
    readonly code: CredentialLeaseErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
    this.name = 'CredentialLeaseError'
  }
}

type Rollout = Readonly<{
  enabled: boolean
  autoLoginAgentIds: ReadonlySet<string>
  autoLoginAllAgents: boolean
}>

type LeaseServiceDependencies = Readonly<{
  persistence: CredentialLeasePersistence
  decryptPort: CredentialDecryptPort
  rollout: Rollout
  seal?: typeof sealCredentialForDevice
  limiter?: typeof consumeCredentialLeaseLimit
  now?: () => Date
  createLeaseId?: () => string
}>

function pageApproved(request: CredentialLeaseRequestV1) {
  return request.page.classification === 'LOGIN' &&
    request.page.origin === 'https://nlg-prod.auth0.com' &&
    request.page.pathname === '/login'
}

function rolloutAllowsAgent(rollout: Rollout, agentId: string) {
  return rollout.autoLoginAllAgents || rollout.autoLoginAgentIds.has(agentId)
}

function validateDevice(context: CredentialLeaseContext, input: { agentId: string; deviceId: string }) {
  const device = context.device
  if (
    !device || device.id !== input.deviceId || device.agentId !== input.agentId ||
    device.status !== 'ACTIVE' || device.revokedAt
  ) throw new CredentialLeaseError('CREDENTIAL_DEVICE_NOT_ACTIVE')
  if (!device.encryptionPublicKeyJwk || !device.encryptionKeyThumbprint) {
    throw new CredentialLeaseError('DEVICE_ENCRYPTION_KEY_REQUIRED')
  }
  let thumbprint: string
  try {
    thumbprint = credentialEncryptionKeyThumbprint(device.encryptionPublicKeyJwk as JsonWebKey)
  } catch {
    throw new CredentialLeaseError('DEVICE_ENCRYPTION_KEY_REQUIRED')
  }
  if (thumbprint !== device.encryptionKeyThumbprint) {
    throw new CredentialLeaseError('CREDENTIAL_DEVICE_KEY_CONFLICT')
  }
  return device
}

function validateCredential(context: CredentialLeaseContext, agentId: string) {
  const credential = context.credential
  if (!credential || credential.agentId !== agentId || credential.provider !== 'NATIONAL_LIFE') {
    throw new CredentialLeaseError('CREDENTIAL_NOT_CONFIGURED')
  }
  if (
    credential.encryptionProvider !== 'VAULT_TRANSIT' || credential.formatVersion !== 1 ||
    !credential.keyVersion || !/^v[1-9][0-9]*$/.test(credential.keyVersion) ||
    !credential.encryptedPayload || !/^vault:v[1-9][0-9]*:[A-Za-z0-9+/=_-]+$/.test(credential.encryptedPayload) ||
    !credential.autoLoginEnabled ||
    !['UNTESTED', 'READY'].includes(credential.status) || credential.revokedAt
  ) throw new CredentialLeaseError('CREDENTIAL_AUTO_LOGIN_DISABLED')
  return credential
}

function validateOperation(
  context: CredentialLeaseContext,
  input: { agentId: string; deviceId: string; request: CredentialLeaseRequestV1; now: Date },
) {
  const operation = context.operation
  if (
    !operation || operation.kind !== input.request.operation.kind ||
    operation.id !== input.request.operation.id || operation.agentId !== input.agentId ||
    operation.deviceId !== input.deviceId || operation.authState !== 'AUTH_REQUIRED' ||
    operation.authEpoch < 1 || operation.latestEventType === 'MFA_REQUIRED' ||
    (operation.kind === 'SYNC_RUN' && operation.state !== 'RUNNING') ||
    (operation.kind === 'CONNECTOR_COMMAND' && operation.state !== 'AUTH_REQUIRED') ||
    (operation.kind === 'CONNECTOR_COMMAND' && (!operation.expiresAt || operation.expiresAt <= input.now))
  ) throw new CredentialLeaseError('CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED')
  if (
    !operation.authRequiredAt ||
    operation.authRequiredAt > input.now ||
    input.now.getTime() - operation.authRequiredAt.getTime() > AUTH_STATE_MAX_AGE_MS
  ) throw new CredentialLeaseError('CREDENTIAL_AUTH_STATE_EXPIRED')
  return operation
}

function mapLimitResult(result: CredentialLeaseLimitResult): void {
  if (result.allowed) return
  throw new CredentialLeaseError(result.code, 'retryAfterSeconds' in result
    ? result.retryAfterSeconds
    : undefined)
}

export function createCredentialLeaseService(deps: LeaseServiceDependencies) {
  return {
    async issueCredentialLease(input: {
      agentId: string
      deviceId: string
      request: unknown
    }): Promise<SealedCredentialLeaseV1> {
      if (!deps.rollout.enabled) throw new CredentialLeaseError('CREDENTIAL_FEATURE_DISABLED')
      if (!rolloutAllowsAgent(deps.rollout, input.agentId)) {
        throw new CredentialLeaseError('CREDENTIAL_AGENT_NOT_ALLOWED')
      }
      const request = parseCredentialLeaseRequest(input.request)
      if (!request || !pageApproved(request)) {
        throw new CredentialLeaseError('CREDENTIAL_PAGE_NOT_APPROVED')
      }

      const now = (deps.now ?? (() => new Date()))()
      const context = await deps.persistence.loadIssueContext({
        agentId: input.agentId,
        deviceId: input.deviceId,
        operation: request.operation,
      })
      const device = validateDevice(context, input)
      const credential = validateCredential(context, input.agentId)
      const operation = validateOperation(context, { ...input, request, now })
      if (context.existingLease) {
        throw new CredentialLeaseError('CREDENTIAL_LEASE_ALREADY_ISSUED')
      }

      mapLimitResult(await (deps.limiter ?? consumeCredentialLeaseLimit)({
        agentId: input.agentId,
        deviceId: input.deviceId,
        agentMax: 3,
        agentWindowSeconds: 900,
        deviceMax: 5,
        deviceWindowSeconds: 3_600,
      }))

      const leaseId = (deps.createLeaseId ?? (() => `lease_${randomUUID()}`))()
      const expiresAt = new Date(now.getTime() + LEASE_LIFETIME_MS)
      const reserved = await deps.persistence.reserveLease({
        leaseId,
        agentId: input.agentId,
        credentialId: credential.id,
        deviceId: input.deviceId,
        operationKind: operation.kind,
        operationId: operation.id,
        authEpoch: operation.authEpoch,
        deviceKeyThumbprint: device.encryptionKeyThumbprint!,
        issuedAt: now,
        expiresAt,
        lastLeasedAt: now,
      })
      if (!reserved) throw new CredentialLeaseError('CREDENTIAL_LEASE_ALREADY_ISSUED')

      let plaintext: { formatVersion: 1; username: string; password: string } | undefined
      try {
        plaintext = { ...(await deps.decryptPort.decrypt({
          stored: {
            encryptionProvider: 'VAULT_TRANSIT',
            formatVersion: 1,
            keyVersion: credential.keyVersion as `v${number}`,
            encryptedPayload: credential.encryptedPayload!,
          },
          binding: {
            agentId: input.agentId,
            formatVersion: 1,
            provider: 'NATIONAL_LIFE',
            purpose: 'PORTAL_CREDENTIAL',
          },
        })) }
        return await (deps.seal ?? sealCredentialForDevice)({
          credential: plaintext,
          publicKeyJwk: device.encryptionPublicKeyJwk,
          leaseId,
          expiresAt,
          operation: {
            kind: operation.kind,
            id: operation.id,
            authEpoch: operation.authEpoch,
          },
        })
      } catch {
        await deps.persistence.markDeliveryFailed({
          leaseId,
          outcome: 'DELIVERY_FAILED',
          now,
        })
        throw new CredentialLeaseError('CREDENTIAL_DELIVERY_FAILED')
      } finally {
        if (plaintext) {
          plaintext.username = ''
          plaintext.password = ''
        }
      }
    },

    async recordCredentialLeaseOutcome(input: {
      agentId: string
      deviceId: string
      leaseId: string
      result: unknown
    }) {
      const result = parseCredentialLeaseResult(input.result)
      if (!result) throw new CredentialLeaseError('CREDENTIAL_LEASE_NOT_ACTIVE')
      const lease = await deps.persistence.loadResultLease(input)
      if (!lease || lease.agentId !== input.agentId || lease.deviceId !== input.deviceId) {
        throw new CredentialLeaseError('CREDENTIAL_LEASE_NOT_ACTIVE')
      }
      if (lease.status !== 'ISSUED' || lease.reportedAt) {
        throw new CredentialLeaseError('CREDENTIAL_LEASE_ALREADY_REPORTED')
      }
      const committed = await deps.persistence.commitOutcome({
        agentId: input.agentId,
        deviceId: input.deviceId,
        leaseId: input.leaseId,
        outcome: result.outcome,
        now: (deps.now ?? (() => new Date()))(),
      })
      if (!committed) throw new CredentialLeaseError('CREDENTIAL_LEASE_ALREADY_REPORTED')
      return { leaseId: lease.id, outcome: result.outcome }
    },
  }
}

type CredentialLeasePrisma = Pick<PrismaClient,
  'nationalLifeConnectorDevice' |
  'agentIntegrationCredential' |
  'nationalLifeSyncRun' |
  'nationalLifeConnectorCommand' |
  'nationalLifeCredentialLease' |
  '$transaction'>

export function createPrismaCredentialLeasePersistence(
  db: CredentialLeasePrisma,
): CredentialLeasePersistence {
  return {
    async loadIssueContext(input) {
      const [device, credential] = await Promise.all([
        db.nationalLifeConnectorDevice.findFirst({
          where: { id: input.deviceId },
          select: {
            id: true,
            agentId: true,
            status: true,
            revokedAt: true,
            encryptionPublicKeyJwk: true,
            encryptionKeyThumbprint: true,
          },
        }),
        db.agentIntegrationCredential.findUnique({
          where: { agentId_provider: { agentId: input.agentId, provider: 'NATIONAL_LIFE' } },
          select: {
            id: true,
            agentId: true,
            provider: true,
            encryptionProvider: true,
            formatVersion: true,
            keyVersion: true,
            encryptedPayload: true,
            autoLoginEnabled: true,
            status: true,
            revokedAt: true,
          },
        }),
      ])
      const operation = input.operation.kind === 'SYNC_RUN'
        ? await db.nationalLifeSyncRun.findFirst({
            where: { id: input.operation.id },
            select: {
              id: true,
              agentId: true,
              connectorDeviceId: true,
              state: true,
              authState: true,
              authEpoch: true,
              authRequiredAt: true,
            },
          }).then((run) => run ? {
            kind: 'SYNC_RUN' as const,
            id: run.id,
            agentId: run.agentId,
            deviceId: run.connectorDeviceId,
            state: run.state,
            authState: run.authState,
            authEpoch: run.authEpoch,
            authRequiredAt: run.authRequiredAt,
            expiresAt: null,
            latestEventType: null,
          } : null)
        : await db.nationalLifeConnectorCommand.findFirst({
            where: { id: input.operation.id },
            select: {
              id: true,
              agentId: true,
              deviceId: true,
              state: true,
              authState: true,
              authEpoch: true,
              authRequiredAt: true,
              expiresAt: true,
              events: {
                orderBy: { sequence: 'desc' },
                take: 1,
                select: { type: true },
              },
            },
          }).then((command) => command ? {
            kind: 'CONNECTOR_COMMAND' as const,
            id: command.id,
            agentId: command.agentId,
            deviceId: command.deviceId,
            state: command.state,
            authState: command.authState,
            authEpoch: command.authEpoch,
            authRequiredAt: command.authRequiredAt,
            expiresAt: command.expiresAt,
            latestEventType: command.events[0]?.type ?? null,
          } : null)
      const existingLease = operation
        ? Boolean(await db.nationalLifeCredentialLease.findUnique({
            where: {
              deviceId_operationKind_operationId_authEpoch: {
                deviceId: input.deviceId,
                operationKind: operation.kind,
                operationId: operation.id,
                authEpoch: operation.authEpoch,
              },
            },
            select: { id: true },
          }))
        : false
      return { device, credential, operation, existingLease }
    },

    async reserveLease(input) {
      try {
        await db.$transaction(async (transaction) => {
          const activeDevice = await transaction.nationalLifeConnectorDevice.findFirst({
            where: {
              id: input.deviceId,
              agentId: input.agentId,
              status: 'ACTIVE',
              revokedAt: null,
              encryptionKeyThumbprint: input.deviceKeyThumbprint,
            },
            select: { id: true },
          })
          if (!activeDevice) throw new CredentialLeaseError('CREDENTIAL_DEVICE_NOT_ACTIVE')

          const activeOperation = input.operationKind === 'SYNC_RUN'
            ? await transaction.nationalLifeSyncRun.findFirst({
                where: {
                  id: input.operationId,
                  agentId: input.agentId,
                  connectorDeviceId: input.deviceId,
                  state: 'RUNNING',
                  authState: 'AUTH_REQUIRED',
                  authEpoch: input.authEpoch,
                },
                select: { id: true },
              })
            : await transaction.nationalLifeConnectorCommand.findFirst({
                where: {
                  id: input.operationId,
                  agentId: input.agentId,
                  deviceId: input.deviceId,
                  state: 'AUTH_REQUIRED',
                  authState: 'AUTH_REQUIRED',
                  authEpoch: input.authEpoch,
                  expiresAt: { gt: input.issuedAt },
                },
                select: { id: true },
              })
          if (!activeOperation) {
            throw new CredentialLeaseError('CREDENTIAL_OPERATION_NOT_AUTH_REQUIRED')
          }

          await transaction.nationalLifeCredentialLease.create({
            data: {
              id: input.leaseId,
              agentId: input.agentId,
              credentialId: input.credentialId,
              deviceId: input.deviceId,
              operationKind: input.operationKind,
              operationId: input.operationId,
              authEpoch: input.authEpoch,
              status: 'ISSUED',
              issuedAt: input.issuedAt,
              expiresAt: input.expiresAt,
            },
          })
          const credential = await transaction.agentIntegrationCredential.updateMany({
            where: {
              id: input.credentialId,
              agentId: input.agentId,
              autoLoginEnabled: true,
              revokedAt: null,
            },
            data: { lastLeasedAt: input.lastLeasedAt },
          })
          if (credential.count !== 1) {
            throw new CredentialLeaseError('CREDENTIAL_AUTO_LOGIN_DISABLED')
          }
        })
        return true
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return false
        }
        throw error
      }
    },

    async markDeliveryFailed(input) {
      await db.nationalLifeCredentialLease.updateMany({
        where: { id: input.leaseId, status: 'ISSUED', reportedAt: null },
        data: { status: 'FAILED', outcome: input.outcome, reportedAt: input.now },
      })
    },

    async loadResultLease(input) {
      return db.nationalLifeCredentialLease.findFirst({
        where: { id: input.leaseId },
        select: {
          id: true,
          agentId: true,
          deviceId: true,
          credentialId: true,
          operationKind: true,
          operationId: true,
          authEpoch: true,
          status: true,
          reportedAt: true,
        },
      })
    },

    async commitOutcome(input) {
      return db.$transaction(async (transaction) => {
        const lease = await transaction.nationalLifeCredentialLease.findFirst({
          where: {
            id: input.leaseId,
            agentId: input.agentId,
            deviceId: input.deviceId,
            status: 'ISSUED',
            reportedAt: null,
          },
          select: {
            id: true,
            credentialId: true,
            operationKind: true,
            operationId: true,
            authEpoch: true,
            agent: { select: { userId: true } },
          },
        })
        if (!lease) return false
        const terminal = await transaction.nationalLifeCredentialLease.updateMany({
          where: { id: lease.id, status: 'ISSUED', reportedAt: null },
          data: {
            status: 'COMPLETED',
            outcome: input.outcome,
            reportedAt: input.now,
          },
        })
        if (terminal.count !== 1) return false

        if (input.outcome === 'AUTHENTICATED') {
          await transaction.agentIntegrationCredential.updateMany({
            where: { id: lease.credentialId, agentId: input.agentId, revokedAt: null },
            data: {
              status: 'READY',
              lastTestedAt: input.now,
              lastSucceededAt: input.now,
            },
          })
        } else if (input.outcome === 'REJECTED') {
          await transaction.agentIntegrationCredential.updateMany({
            where: { id: lease.credentialId, agentId: input.agentId, revokedAt: null },
            data: {
              status: 'REJECTED',
              autoLoginEnabled: false,
              lastTestedAt: input.now,
              lastRejectedAt: input.now,
            },
          })
        } else if (input.outcome === 'MFA_REQUIRED') {
          // Sync auth-state uses the same key, so the lease result and the run
          // transition converge on one notification instead of creating two.
          const dedupeKey = lease.operationKind === 'SYNC_RUN'
            ? `national-life-mfa-required:${lease.operationId}:${lease.authEpoch}`
            : `national-life-mfa-required:${lease.operationKind}:${lease.operationId}:${lease.authEpoch}`
          await transaction.notification.upsert({
            where: { dedupeKey },
            create: {
              recipientUserId: lease.agent.userId,
              type: 'NATIONAL_LIFE_MFA_REQUIRED',
              title: 'A National Life precisa da sua verificação',
              message: 'Conclua o MFA diretamente na National Life. O K-Bot continuará depois da verificação.',
              href: '/agent/integrations/national-life',
              dedupeKey,
              createdAt: input.now,
            },
            update: { readAt: null, createdAt: input.now },
          })
        }

        await transaction.auditLog.create({
          data: {
            userId: lease.agent.userId,
            action: 'NATIONAL_LIFE_CREDENTIAL_LEASE_RESULT',
            entity: 'NationalLifeCredentialLease',
            entityId: lease.id,
            after: {
              agentId: input.agentId,
              deviceId: input.deviceId,
              operationKind: lease.operationKind,
              operationId: lease.operationId,
              authEpoch: lease.authEpoch,
              outcome: input.outcome,
            },
          },
        })
        return true
      })
    },
  }
}
