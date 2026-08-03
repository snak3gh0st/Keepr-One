import { Buffer } from 'node:buffer'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { EncryptedBrowserSecret } from './browser-context-crypto'
import type { NationalLifeConnectionAttemptState } from './connection-attempt-state'
import { releaseJobsBlockedOnCarrierLogin } from './job-service'
import {
  NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS,
  NATIONAL_LIFE_CONNECTION_RATE_LIMIT,
  NATIONAL_LIFE_CONNECTION_RATE_WINDOW_MS,
  NATIONAL_LIFE_PROVIDER,
  NATIONAL_LIFE_VIEWER_TOKEN_TTL_MS,
} from './constants'
import {
  createViewerBootstrapToken,
  hashViewerNonce,
  verifyViewerBootstrapToken,
  type ViewerBootstrapPayload,
} from './viewer-token'
import { getNationalLifeEnv } from './env'

const ATTEMPT_PURPOSE = 'INTERACTIVE_CONNECTION_ATTEMPT'
const SESSION_PURPOSE = 'CARRIER_SESSION'
const DEFAULT_DEPLOYMENT_SCOPE = 'SINGLE_DEPLOYMENT'
const ACTIVE_ATTEMPT_STATES: NationalLifeConnectionAttemptState[] = [
  'OPENING_PORTAL',
  'AWAITING_LOGIN',
  'AWAITING_MFA',
]
const VIEWER_ATTEMPT_STATES: NationalLifeConnectionAttemptState[] = [
  'AWAITING_LOGIN',
  'AWAITING_MFA',
]
const TERMINAL_ATTEMPT_STATES: NationalLifeConnectionAttemptState[] = [
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]

export type ConnectionAttemptStatus = {
  id: string
  state: NationalLifeConnectionAttemptState
  currentOrigin: string | null
  safeErrorCode: string | null
  expiresAt: Date
}

export type AgentSessionSummary = {
  provider: 'NATIONAL_LIFE'
  status: 'CONNECTED' | 'SESSION_EXPIRED'
  lastConnectedAt: Date
  /// Written only after an authenticated page answered, so it is a timestamped
  /// successful check and not merely "we tried".
  lastUsedAt: Date | null
  /// Derived from the shortest cookie expiry, measured to be Cloudflare's bot
  /// cookie. Kept for diagnostics; never presented as a session deadline.
  carrierExpiresAt: Date | null
  /// What the last keep-alive tick found on the far side of the SSO jump, or
  /// null when no tick has crossed it. Says nothing about the next tick.
  illustrationSsoReachable: boolean | null
  illustrationSsoCheckedAt: Date | null
}

export type AgentSessionHealth = {
  agentId: string
  agentName: string
  status: 'CONNECTED' | 'SESSION_EXPIRED'
  lastConnectedAt: Date
  lastUsedAt: Date | null
  carrierExpiresAt: Date | null
  illustrationSsoReachable: boolean | null
  illustrationSsoCheckedAt: Date | null
}

export type StartConnectionResult =
  | { kind: 'STARTED'; attempt: ConnectionAttemptStatus }
  | { kind: 'EXISTING'; attempt: ConnectionAttemptStatus }
  | { kind: 'RATE_LIMITED' }

export type StoredConnectionAttempt = {
  id: string
  agentId: string
  provider: string
  state: NationalLifeConnectionAttemptState
  formatVersion: number
  runtimeKeyVersion: string | null
  runtimeAlgorithm: string | null
  runtimeIv: string | null
  runtimeCiphertext: string | null
  runtimeAuthTag: string | null
  viewerNonceHash: string | null
  currentOrigin: string | null
  safeErrorCode: string | null
  expiresAt: Date
}

export type StoredIntegrationSession = {
  id: string
  agentId: string
  agentName: string
  provider: string
  status: string
  formatVersion: number
  keyVersion: string | null
  algorithm: string | null
  iv: string | null
  ciphertext: string | null
  authTag: string | null
  carrierExpiresAt: Date | null
  lastConnectedAt: Date
  lastUsedAt: Date | null
  illustrationSsoReachable: boolean | null
  illustrationSsoCheckedAt: Date | null
}

export type InteractiveConnectionRepository = {
  findActiveAttempt(
    agentId: string,
    provider: string,
    deploymentScope: string,
    purpose: string,
  ): Promise<StoredConnectionAttempt | null>
  createAttemptWithAudit(input: {
    agentId: string
    userId: string
    deploymentScope: string
    now: Date
    expiresAt: Date
    rateWindowStartedAt: Date
    rateLimit: number
  }): Promise<
    | { kind: 'CREATED'; attempt: StoredConnectionAttempt }
    | { kind: 'CONFLICT' }
    | { kind: 'RATE_LIMITED' }
    | { kind: 'BLOCKED_EXPIRED' }
  >
  findOwnedAttempt(
    agentId: string,
    provider: string,
    attemptId: string,
    deploymentScope: string,
    purpose: string,
  ): Promise<StoredConnectionAttempt | null>
  storeViewerNonce(input: {
    agentId: string
    attemptId: string
    deploymentScope: string
    nonceHash: string
    now: Date
  }): Promise<boolean>
  consumeViewerNonce(input: {
    agentId: string
    attemptId: string
    deploymentScope: string
    nonceHash: string
    now: Date
  }): Promise<boolean>
  cancelOwnedAttempt(input: {
    agentId: string
    userId: string
    attemptId: string
    deploymentScope: string
    now: Date
  }): Promise<boolean>
  completeOwnedAttempt(input: {
    agentId: string
    attemptId: string
    deploymentScope: string
    encryptedContext: EncryptedBrowserSecret
    carrierExpiresAt: Date | null
    now: Date
  }): Promise<boolean>
  invalidateOwnedSession(input: {
    agentId: string
    deploymentScope: string
    now: Date
  }): Promise<boolean>
  disconnectOwnedAgent(input: {
    agentId: string
    userId: string
    deploymentScope: string
    now: Date
  }): Promise<{ attemptCancelled: boolean; sessionDeleted: boolean }>
  findOwnedSession(
    agentId: string,
    provider: string,
    deploymentScope: string,
    purpose: string,
  ): Promise<StoredIntegrationSession | null>
  listSessionHealth(
    provider: string,
    deploymentScope: string,
    purpose: string,
  ): Promise<StoredIntegrationSession[]>
}

export type InteractiveConnectionConfig = {
  interactiveLoginEnabled: boolean
  interactiveLoginAgentIds: ReadonlySet<string>
  interactiveLoginAllAgents: boolean
  viewerPublicOrigin: string
  viewerSigningKey: Buffer
  deploymentScope?: string
}

export type InteractiveConnectionServiceDeps = {
  repository?: InteractiveConnectionRepository
  now?: () => Date
  config?: InteractiveConnectionConfig
}

const attemptSelect = {
  id: true,
  agentId: true,
  provider: true,
  state: true,
  formatVersion: true,
  runtimeKeyVersion: true,
  runtimeAlgorithm: true,
  runtimeIv: true,
  runtimeCiphertext: true,
  runtimeAuthTag: true,
  viewerNonceHash: true,
  currentOrigin: true,
  safeErrorCode: true,
  expiresAt: true,
} satisfies Prisma.NationalLifeConnectionAttemptSelect

const sessionSelect = {
  id: true,
  agentId: true,
  agent: { select: { user: { select: { name: true } } } },
  provider: true,
  status: true,
  formatVersion: true,
  keyVersion: true,
  algorithm: true,
  iv: true,
  ciphertext: true,
  authTag: true,
  carrierExpiresAt: true,
  lastConnectedAt: true,
  lastUsedAt: true,
  illustrationSsoReachable: true,
  illustrationSsoCheckedAt: true,
} satisfies Prisma.AgentIntegrationSessionSelect

function normalizeAttempt(
  attempt: Prisma.NationalLifeConnectionAttemptGetPayload<{ select: typeof attemptSelect }>,
): StoredConnectionAttempt {
  return {
    ...attempt,
    state: attempt.state as NationalLifeConnectionAttemptState,
  }
}

function normalizeSession(
  session: Prisma.AgentIntegrationSessionGetPayload<{ select: typeof sessionSelect }>,
): StoredIntegrationSession {
  return {
    ...session,
    agentName: session.agent.user.name,
  }
}

const prismaRepository: InteractiveConnectionRepository = {
  async findActiveAttempt(agentId, provider, deploymentScope, purpose) {
    const attempt = await prisma.nationalLifeConnectionAttempt.findUnique({
      where: {
        agentId_deploymentScope_provider_purpose: {
          agentId,
          deploymentScope,
          provider,
          purpose,
        },
      },
      select: attemptSelect,
    })
    return attempt ? normalizeAttempt(attempt) : null
  },

  async createAttemptWithAudit(input) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const recentStarts = await transaction.auditLog.count({
          where: {
            userId: input.userId,
            action: 'NATIONAL_LIFE_CONNECTION_STARTED',
            createdAt: { gte: input.rateWindowStartedAt },
          },
        })
        if (recentStarts >= input.rateLimit) {
          return { kind: 'RATE_LIMITED' as const }
        }

        const current = await transaction.nationalLifeConnectionAttempt.findUnique({
          where: {
            agentId_deploymentScope_provider_purpose: {
              agentId: input.agentId,
              deploymentScope: input.deploymentScope,
              provider: NATIONAL_LIFE_PROVIDER,
              purpose: ATTEMPT_PURPOSE,
            },
          },
          select: { id: true, state: true, expiresAt: true },
        })
        if (current) {
          if (
            TERMINAL_ATTEMPT_STATES.includes(
              current.state as NationalLifeConnectionAttemptState,
            )
          ) {
            await transaction.nationalLifeConnectionAttempt.delete({
              where: { id: current.id },
            })
          } else {
            return current.expiresAt > input.now
              ? { kind: 'CONFLICT' as const }
              : { kind: 'BLOCKED_EXPIRED' as const }
          }
        }

        const attempt = await transaction.nationalLifeConnectionAttempt.create({
          data: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            provider: NATIONAL_LIFE_PROVIDER,
            purpose: ATTEMPT_PURPOSE,
            state: 'OPENING_PORTAL',
            expiresAt: input.expiresAt,
          },
          select: attemptSelect,
        })
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: 'NATIONAL_LIFE_CONNECTION_STARTED',
            entity: 'NationalLifeConnectionAttempt',
            entityId: attempt.id,
            after: {
              result: 'STARTED',
              timestamp: input.now.toISOString(),
            },
            createdAt: input.now,
          },
        })
        return { kind: 'CREATED' as const, attempt: normalizeAttempt(attempt) }
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { kind: 'CONFLICT' }
      }
      throw error
    }
  },

  async findOwnedAttempt(agentId, provider, attemptId, deploymentScope, purpose) {
    const attempt = await prisma.nationalLifeConnectionAttempt.findFirst({
      where: { id: attemptId, agentId, provider, deploymentScope, purpose },
      select: attemptSelect,
    })
    return attempt ? normalizeAttempt(attempt) : null
  },

  async storeViewerNonce(input) {
    const result = await prisma.nationalLifeConnectionAttempt.updateMany({
      where: {
        id: input.attemptId,
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        provider: NATIONAL_LIFE_PROVIDER,
        purpose: ATTEMPT_PURPOSE,
        state: { in: VIEWER_ATTEMPT_STATES },
        expiresAt: { gt: input.now },
      },
      data: { viewerNonceHash: input.nonceHash },
    })
    return result.count === 1
  },

  async consumeViewerNonce(input) {
    const result = await prisma.nationalLifeConnectionAttempt.updateMany({
      where: {
        id: input.attemptId,
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        provider: NATIONAL_LIFE_PROVIDER,
        purpose: ATTEMPT_PURPOSE,
        state: { in: VIEWER_ATTEMPT_STATES },
        expiresAt: { gt: input.now },
        viewerNonceHash: input.nonceHash,
      },
      data: { viewerNonceHash: null },
    })
    return result.count === 1
  },

  async cancelOwnedAttempt(input) {
    return prisma.$transaction(async (transaction) => {
      const result = await transaction.nationalLifeConnectionAttempt.updateMany({
        where: {
          id: input.attemptId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: { in: ACTIVE_ATTEMPT_STATES },
        },
        data: {
          state: 'CANCELLED',
          viewerNonceHash: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      if (result.count !== 1) {
        return false
      }
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: 'NATIONAL_LIFE_CONNECTION_CANCELLED',
          entity: 'NationalLifeConnectionAttempt',
          entityId: input.attemptId,
          after: {
            result: 'CANCELLED',
            timestamp: input.now.toISOString(),
          },
          createdAt: input.now,
        },
      })
      return true
    })
  },

  async completeOwnedAttempt(input) {
    return prisma.$transaction(async (transaction) => {
      const attempt = await transaction.nationalLifeConnectionAttempt.findFirst({
        where: {
          id: input.attemptId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: { in: VIEWER_ATTEMPT_STATES },
        },
        select: { id: true },
      })
      if (!attempt) {
        return false
      }

      await transaction.agentIntegrationSession.upsert({
        where: {
          agentId_deploymentScope_provider_purpose: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            provider: NATIONAL_LIFE_PROVIDER,
            purpose: SESSION_PURPOSE,
          },
        },
        create: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: SESSION_PURPOSE,
          status: 'CONNECTED',
          formatVersion: 1,
          keyVersion: input.encryptedContext.keyVersion,
          algorithm: input.encryptedContext.algorithm,
          iv: input.encryptedContext.iv,
          ciphertext: input.encryptedContext.ciphertext,
          authTag: input.encryptedContext.authTag,
          carrierExpiresAt: input.carrierExpiresAt,
          lastConnectedAt: input.now,
          lastUsedAt: null,
        },
        update: {
          status: 'CONNECTED',
          formatVersion: 1,
          keyVersion: input.encryptedContext.keyVersion,
          algorithm: input.encryptedContext.algorithm,
          iv: input.encryptedContext.iv,
          ciphertext: input.encryptedContext.ciphertext,
          authTag: input.encryptedContext.authTag,
          carrierExpiresAt: input.carrierExpiresAt,
          lastConnectedAt: input.now,
          lastUsedAt: null,
        },
      })
      // Same transaction as the connect — releaseJobsBlockedOnCarrierLogin
      // carries the why, and names the other call site.
      await releaseJobsBlockedOnCarrierLogin(transaction, {
        agentId: input.agentId,
        now: input.now,
      })
      const deleted = await transaction.nationalLifeConnectionAttempt.deleteMany({
        where: {
          id: input.attemptId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
        },
      })
      if (deleted.count !== 1) {
        throw new Error('National Life connection completion failed')
      }
      return true
    })
  },

  async invalidateOwnedSession(input) {
    const result = await prisma.agentIntegrationSession.updateMany({
      where: {
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        provider: NATIONAL_LIFE_PROVIDER,
        purpose: SESSION_PURPOSE,
      },
      data: {
        status: 'SESSION_EXPIRED',
        keyVersion: null,
        algorithm: null,
        iv: null,
        ciphertext: null,
        authTag: null,
      },
    })
    return result.count === 1
  },

  async disconnectOwnedAgent(input) {
    return prisma.$transaction(async (transaction) => {
      const cancelled = await transaction.nationalLifeConnectionAttempt.updateMany({
        where: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: { in: ACTIVE_ATTEMPT_STATES },
        },
        data: {
          state: 'CANCELLED',
          viewerNonceHash: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      const deleted = await transaction.agentIntegrationSession.deleteMany({
        where: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: SESSION_PURPOSE,
        },
      })
      if (cancelled.count > 0 || deleted.count > 0) {
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: 'NATIONAL_LIFE_CONNECTION_DISCONNECTED',
            entity: 'Agent',
            entityId: input.agentId,
            after: {
              result: 'DISCONNECTED',
              timestamp: input.now.toISOString(),
            },
            createdAt: input.now,
          },
        })
      }
      return {
        attemptCancelled: cancelled.count > 0,
        sessionDeleted: deleted.count > 0,
      }
    })
  },

  async findOwnedSession(agentId, provider, deploymentScope, purpose) {
    const session = await prisma.agentIntegrationSession.findUnique({
      where: {
        agentId_deploymentScope_provider_purpose: {
          agentId,
          deploymentScope,
          provider,
          purpose,
        },
      },
      select: sessionSelect,
    })
    return session ? normalizeSession(session) : null
  },

  async listSessionHealth(provider, deploymentScope, purpose) {
    const sessions = await prisma.agentIntegrationSession.findMany({
      where: { provider, deploymentScope, purpose },
      select: sessionSelect,
      orderBy: { lastConnectedAt: 'desc' },
    })
    return sessions.map(normalizeSession)
  },
}

function resolveRepository(deps?: InteractiveConnectionServiceDeps) {
  return deps?.repository ?? prismaRepository
}

function resolveNow(deps?: InteractiveConnectionServiceDeps) {
  return (deps?.now ?? (() => new Date()))()
}

function resolveConfig(deps?: InteractiveConnectionServiceDeps): Required<InteractiveConnectionConfig> {
  if (deps?.config) {
    return {
      ...deps.config,
      deploymentScope: deps.config.deploymentScope ?? DEFAULT_DEPLOYMENT_SCOPE,
    }
  }

  const env = getNationalLifeEnv()

  return {
    interactiveLoginEnabled: env.interactiveLoginEnabled,
    interactiveLoginAgentIds: env.interactiveLoginAgentIds,
    interactiveLoginAllAgents: env.interactiveLoginAllAgents,
    viewerPublicOrigin: env.viewerPublicOrigin,
    viewerSigningKey: env.viewerSigningKey,
    deploymentScope: env.sessionScopeId,
  }
}

function toAttemptStatus(attempt: StoredConnectionAttempt): ConnectionAttemptStatus {
  return {
    id: attempt.id,
    state: attempt.state,
    currentOrigin: attempt.currentOrigin,
    safeErrorCode: attempt.safeErrorCode,
    expiresAt: attempt.expiresAt,
  }
}

function assertInteractiveAccess(
  agentId: string,
  config: Required<InteractiveConnectionConfig>,
) {
  if (!config.interactiveLoginEnabled) {
    throw new Error('National Life interactive login is unavailable')
  }
  if (!config.interactiveLoginAllAgents && !config.interactiveLoginAgentIds.has(agentId)) {
    throw new Error('National Life interactive login is unavailable')
  }
}

export async function startConnectionAttempt(
  input: { agentId: string; userId: string },
  deps?: InteractiveConnectionServiceDeps,
): Promise<StartConnectionResult> {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const now = resolveNow(deps)
  assertInteractiveAccess(input.agentId, config)

  const existing = await repository.findActiveAttempt(
    input.agentId,
    NATIONAL_LIFE_PROVIDER,
    config.deploymentScope,
    ATTEMPT_PURPOSE,
  )
  if (
    existing &&
    existing.expiresAt > now &&
    ACTIVE_ATTEMPT_STATES.includes(existing.state)
  ) {
    return { kind: 'EXISTING', attempt: toAttemptStatus(existing) }
  }

  const created = await repository.createAttemptWithAudit({
    ...input,
    deploymentScope: config.deploymentScope,
    now,
    expiresAt: new Date(now.getTime() + NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS),
    rateWindowStartedAt: new Date(
      now.getTime() - NATIONAL_LIFE_CONNECTION_RATE_WINDOW_MS,
    ),
    rateLimit: NATIONAL_LIFE_CONNECTION_RATE_LIMIT,
  })
  if (created.kind === 'RATE_LIMITED') {
    return { kind: 'RATE_LIMITED' }
  }
  if (created.kind === 'BLOCKED_EXPIRED') {
    throw new Error('National Life connection attempt cleanup is pending')
  }
  if (created.kind === 'CONFLICT') {
    const concurrent = await repository.findActiveAttempt(
      input.agentId,
      NATIONAL_LIFE_PROVIDER,
      config.deploymentScope,
      ATTEMPT_PURPOSE,
    )
    if (
      concurrent &&
      concurrent.expiresAt > now &&
      ACTIVE_ATTEMPT_STATES.includes(concurrent.state)
    ) {
      return { kind: 'EXISTING', attempt: toAttemptStatus(concurrent) }
    }
    throw new Error('National Life connection attempt unavailable')
  }
  return { kind: 'STARTED', attempt: toAttemptStatus(created.attempt) }
}

export async function getOwnedAttemptStatus(
  agentId: string,
  attemptId: string,
  deps?: InteractiveConnectionServiceDeps,
): Promise<ConnectionAttemptStatus> {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const attempt = await repository.findOwnedAttempt(
    agentId,
    NATIONAL_LIFE_PROVIDER,
    attemptId,
    config.deploymentScope,
    ATTEMPT_PURPOSE,
  )
  if (!attempt) {
    throw new Error('National Life connection attempt not found')
  }
  return toAttemptStatus(attempt)
}

export async function issueViewerBootstrap(
  input: { agentId: string; attemptId: string },
  deps?: InteractiveConnectionServiceDeps,
) {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const now = resolveNow(deps)
  const attempt = await repository.findOwnedAttempt(
    input.agentId,
    NATIONAL_LIFE_PROVIDER,
    input.attemptId,
    config.deploymentScope,
    ATTEMPT_PURPOSE,
  )
  if (
    !attempt ||
    !VIEWER_ATTEMPT_STATES.includes(attempt.state) ||
    attempt.expiresAt <= now
  ) {
    throw new Error('National Life connection attempt not found')
  }

  const expiresAt = new Date(
    Math.min(
      attempt.expiresAt.getTime(),
      now.getTime() + NATIONAL_LIFE_VIEWER_TOKEN_TTL_MS,
    ),
  )
  const issued = createViewerBootstrapToken(
    {
      attemptId: attempt.id,
      agentId: input.agentId,
      expiresAt: expiresAt.toISOString(),
    },
    config.viewerSigningKey,
  )
  const stored = await repository.storeViewerNonce({
    ...input,
    deploymentScope: config.deploymentScope,
    nonceHash: issued.nonceHash,
    now,
  })
  if (!stored) {
    throw new Error('National Life connection attempt not found')
  }
  return {
    bootstrapUrl: `${config.viewerPublicOrigin}/bootstrap?ticket=${encodeURIComponent(issued.token)}`,
    expiresAt,
  }
}

export async function consumeViewerNonce(
  input: { agentId: string; attemptId: string; ticket: string },
  deps?: InteractiveConnectionServiceDeps,
): Promise<ViewerBootstrapPayload> {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const now = resolveNow(deps)
  const payload = verifyViewerBootstrapToken(
    input.ticket,
    config.viewerSigningKey,
    now,
  )
  if (
    payload.agentId !== input.agentId ||
    payload.attemptId !== input.attemptId
  ) {
    throw new Error('Invalid viewer token')
  }
  const consumed = await repository.consumeViewerNonce({
    agentId: input.agentId,
    attemptId: input.attemptId,
    deploymentScope: config.deploymentScope,
    nonceHash: hashViewerNonce(payload.nonce),
    now,
  })
  if (!consumed) {
    throw new Error('Invalid viewer token')
  }
  return payload
}

export async function cancelConnectionAttempt(
  input: { agentId: string; userId: string; attemptId: string },
  deps?: InteractiveConnectionServiceDeps,
) {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const cancelled = await repository.cancelOwnedAttempt({
    ...input,
    deploymentScope: config.deploymentScope,
    now: resolveNow(deps),
  })
  if (!cancelled) {
    throw new Error('National Life connection attempt not found')
  }
}

export async function completeConnectionAttempt(
  input: {
    agentId: string
    attemptId: string
    encryptedContext: EncryptedBrowserSecret
    carrierExpiresAt: Date | null
  },
  deps?: InteractiveConnectionServiceDeps,
) {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const completed = await repository.completeOwnedAttempt({
    ...input,
    deploymentScope: config.deploymentScope,
    now: resolveNow(deps),
  })
  if (!completed) {
    throw new Error('National Life connection attempt not found')
  }
}

export async function invalidateAgentSession(
  agentId: string,
  deps?: InteractiveConnectionServiceDeps,
) {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  return repository.invalidateOwnedSession({
    agentId,
    deploymentScope: config.deploymentScope,
    now: resolveNow(deps),
  })
}

export async function disconnectAgentSession(
  input: { agentId: string; userId: string },
  deps?: InteractiveConnectionServiceDeps,
) {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  return repository.disconnectOwnedAgent({
    ...input,
    deploymentScope: config.deploymentScope,
    now: resolveNow(deps),
  })
}

export async function getAgentSessionSummary(
  agentId: string,
  deps?: InteractiveConnectionServiceDeps,
): Promise<AgentSessionSummary | null> {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const session = await repository.findOwnedSession(
    agentId,
    NATIONAL_LIFE_PROVIDER,
    config.deploymentScope,
    SESSION_PURPOSE,
  )
  if (!session) {
    return null
  }
  return {
    provider: NATIONAL_LIFE_PROVIDER,
    status:
      session.status === 'CONNECTED' ? 'CONNECTED' : 'SESSION_EXPIRED',
    lastConnectedAt: session.lastConnectedAt,
    lastUsedAt: session.lastUsedAt,
    carrierExpiresAt: session.carrierExpiresAt,
    illustrationSsoReachable: session.illustrationSsoReachable,
    illustrationSsoCheckedAt: session.illustrationSsoCheckedAt,
  }
}

export async function listAgentSessionHealthForAdmin(
  deps?: InteractiveConnectionServiceDeps,
): Promise<AgentSessionHealth[]> {
  const repository = resolveRepository(deps)
  const config = resolveConfig(deps)
  const sessions = await repository.listSessionHealth(
    NATIONAL_LIFE_PROVIDER,
    config.deploymentScope,
    SESSION_PURPOSE,
  )
  return sessions.map((session) => ({
    agentId: session.agentId,
    agentName: session.agentName,
    status:
      session.status === 'CONNECTED' ? 'CONNECTED' : 'SESSION_EXPIRED',
    lastConnectedAt: session.lastConnectedAt,
    lastUsedAt: session.lastUsedAt,
    carrierExpiresAt: session.carrierExpiresAt,
    illustrationSsoReachable: session.illustrationSsoReachable,
    illustrationSsoCheckedAt: session.illustrationSsoCheckedAt,
  }))
}
