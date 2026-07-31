import { type Server } from 'node:http'
import type { EventEmitter } from 'node:events'
import { Prisma, PrismaClient } from '@prisma/client'
import {
  decryptAttemptRuntime,
  type EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import { withOwnedBrowserLockWaiting } from '../../lib/national-life/browser-lock'
import { NATIONAL_LIFE_PROVIDER } from '../../lib/national-life/constants'
import { saveRapidSolveIllustration } from '../../lib/national-life/illustration-service'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import {
  createBrowserJobService,
  type BrowserJobRecord,
} from '../../lib/national-life/job-service'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import { prisma } from '../../lib/prisma'
import { applyCaseObservation } from '../../lib/national-life/sync-service'
import { NationalLifeAdapter } from './adapter'
import {
  runNationalLifeConnectionAttempt,
  type CompleteAttemptInput,
  type RunConnectionAttemptDeps,
  type SetAttemptRuntimeInput,
  type StoredConnectionAttempt,
  type TransitionAttemptInput,
} from './run-connection-attempt'
import {
  createInteractiveSteelSession,
  createSteelBrowserSession,
  captureSteelSessionContext,
  reconnectSteelBrowserSession,
} from './steel-session'
import {
  runNationalLifeJob,
  type NationalLifeJobStore,
  type StoredAgentIntegrationSession,
} from './run-job'
import {
  createNationalLifeViewerBroker,
  type NationalLifeViewerBrokerDeps,
} from './viewer-broker'

const EMPTY_QUEUE_DELAY_MS = 1_000
const ATTEMPT_LEASE_MS = 15_000
const ATTEMPT_PURPOSE = 'INTERACTIVE_CONNECTION_ATTEMPT'
const SESSION_PURPOSE = 'CARRIER_SESSION'
const CLAIMABLE_ATTEMPT_STATES = [
  'OPENING_PORTAL',
  'AWAITING_LOGIN',
  'AWAITING_MFA',
] as const

export function getClaimableConnectionAttemptStates() {
  return [...CLAIMABLE_ATTEMPT_STATES]
}

type RuntimeSignalSource = Pick<EventEmitter, 'once' | 'off'>

export type RuntimeLogContext = {
  kind: 'attempt' | 'job'
  id?: string
  code: 'RUNTIME_CLAIM_FAILED' | 'RUNTIME_UNIT_FAILED'
  durationMs: number
}

export type RuntimeDeps = {
  viewer: NationalLifeViewerBrokerDeps
  signals?: RuntimeSignalSource
  listen(server: Server): Promise<void>
  closeServer(server: Server): Promise<void>
  claimConnectionAttempt(): Promise<{ id: string } | null>
  runConnectionAttempt(attemptId: string): Promise<void>
  claimBrowserJob(): Promise<{ id: string } | null>
  runBrowserJob(jobId: string): Promise<void>
  cleanupLeasedInteractiveAttempts(): Promise<void>
  logError?(context: RuntimeLogContext): void
}

function waitForNextPoll(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, EMPTY_QUEUE_DELAY_MS)
    function finish() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function runWorkLoop(
  kind: 'attempt' | 'job',
  claim: () => Promise<{ id: string } | null>,
  run: (id: string) => Promise<void>,
  deps: Pick<RuntimeDeps, 'logError'>,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const claimStartedAt = Date.now()
    let item: { id: string } | null
    try {
      item = await claim()
    } catch {
      deps.logError?.({
        kind,
        code: 'RUNTIME_CLAIM_FAILED',
        durationMs: Date.now() - claimStartedAt,
      })
      await waitForNextPoll(signal)
      continue
    }

    if (signal.aborted) {
      return
    }
    if (!item) {
      await waitForNextPoll(signal)
      continue
    }

    const unitStartedAt = Date.now()
    try {
      await run(item.id)
    } catch {
      deps.logError?.({
        kind,
        id: item.id,
        code: 'RUNTIME_UNIT_FAILED',
        durationMs: Date.now() - unitStartedAt,
      })
    }

    // An interactive attempt stays claimable for its whole lifetime, so without
    // this pause the loop reconnects to the live carrier page as fast as CDP
    // allows while a human is typing an MFA code into it.
    await waitForNextPoll(signal)
  }
}

export async function runNationalLifeRuntime(deps: RuntimeDeps) {
  const abortController = new AbortController()
  const signals = deps.signals ?? process
  const shutdown = () => abortController.abort()
  signals.once('SIGINT', shutdown)
  signals.once('SIGTERM', shutdown)

  const broker = createNationalLifeViewerBroker(deps.viewer)
  try {
    await deps.listen(broker)
    await Promise.all([
      runWorkLoop(
        'attempt',
        deps.claimConnectionAttempt,
        deps.runConnectionAttempt,
        deps,
        abortController.signal,
      ),
      runWorkLoop(
        'job',
        deps.claimBrowserJob,
        deps.runBrowserJob,
        deps,
        abortController.signal,
      ),
    ])
  } finally {
    signals.off('SIGINT', shutdown)
    signals.off('SIGTERM', shutdown)
    try {
      await deps.cleanupLeasedInteractiveAttempts()
    } finally {
      await deps.closeServer(broker)
    }
  }
}

const attemptSelect = {
  id: true,
  agentId: true,
  state: true,
  formatVersion: true,
  runtimeKeyVersion: true,
  runtimeAlgorithm: true,
  runtimeIv: true,
  runtimeCiphertext: true,
  runtimeAuthTag: true,
  currentOrigin: true,
  safeErrorCode: true,
  expiresAt: true,
} satisfies Prisma.NationalLifeConnectionAttemptSelect

const jobSelect = {
  id: true,
  agentId: true,
  caseId: true,
  provider: true,
  operation: true,
  state: true,
  idempotencyKey: true,
  input: true,
  result: true,
  safeErrorCode: true,
  safeErrorDetail: true,
  attemptCount: true,
  availableAt: true,
  leaseOwner: true,
  leaseExpiresAt: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  continuationKeyVersion: true,
  continuationIv: true,
  continuationCiphertext: true,
  continuationAuthTag: true,
  continuationExpiresAt: true,
} satisfies Prisma.BrowserAutomationJobSelect

const integrationSessionSelect = {
  id: true,
  agentId: true,
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
} satisfies Prisma.AgentIntegrationSessionSelect

function normalizedAttempt(
  value: Prisma.NationalLifeConnectionAttemptGetPayload<{
    select: typeof attemptSelect
  }>,
): StoredConnectionAttempt {
  return value as StoredConnectionAttempt
}

function normalizedJob(
  value: Prisma.BrowserAutomationJobGetPayload<{
    select: typeof jobSelect
  }>,
): BrowserJobRecord {
  return {
    ...value,
    state: value.state as BrowserJobState,
    input: value.input as BrowserJobRecord['input'],
  }
}

function createAttemptStore(
  env: NationalLifeEnv,
): RunConnectionAttemptDeps['store'] {
  return {
    async claim(attemptId, workerId, now) {
      const leaseExpiresAt = new Date(now.getTime() + ATTEMPT_LEASE_MS)
      return prisma.$transaction(async (transaction) => {
        const claimed = await transaction.nationalLifeConnectionAttempt.updateMany({
          where: {
            id: attemptId,
            deploymentScope: env.sessionScopeId,
            provider: NATIONAL_LIFE_PROVIDER,
            purpose: ATTEMPT_PURPOSE,
            state: { in: getClaimableConnectionAttemptStates() },
            OR: [
              { leaseOwner: null },
              { leaseExpiresAt: { lte: now } },
              { leaseOwner: workerId },
            ],
          },
          data: { leaseOwner: workerId, leaseExpiresAt },
        })
        if (claimed.count !== 1) {
          return null
        }
        const attempt =
          await transaction.nationalLifeConnectionAttempt.findUnique({
            where: { id: attemptId },
            select: attemptSelect,
          })
        return attempt ? normalizedAttempt(attempt) : null
      })
    },

    async setRuntime(input: SetAttemptRuntimeInput) {
      const updated = await prisma.nationalLifeConnectionAttempt.updateMany({
        where: {
          id: input.attemptId,
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: input.from,
          leaseOwner: input.workerId,
        },
        data: {
          state: input.state,
          runtimeKeyVersion: input.encryptedRuntime.keyVersion,
          runtimeAlgorithm: input.encryptedRuntime.algorithm,
          runtimeIv: input.encryptedRuntime.iv,
          runtimeCiphertext: input.encryptedRuntime.ciphertext,
          runtimeAuthTag: input.encryptedRuntime.authTag,
          currentOrigin: input.currentOrigin,
          safeErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      if (updated.count !== 1) {
        throw new Error('National Life attempt runtime write was rejected')
      }
    },

    async transition(input: TransitionAttemptInput) {
      const updated = await prisma.nationalLifeConnectionAttempt.updateMany({
        where: {
          id: input.attemptId,
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: input.from,
          leaseOwner: input.workerId,
        },
        data: {
          state: input.to,
          ...(input.currentOrigin !== undefined
            ? { currentOrigin: input.currentOrigin }
            : {}),
          safeErrorCode: input.safeErrorCode ?? null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      })
      if (updated.count !== 1) {
        throw new Error('National Life attempt transition was rejected')
      }
    },

    async complete(input: CompleteAttemptInput) {
      await prisma.$transaction(async (transaction) => {
        const attempt =
          await transaction.nationalLifeConnectionAttempt.findFirst({
            where: {
              id: input.attemptId,
              agentId: input.agentId,
              deploymentScope: env.sessionScopeId,
              provider: NATIONAL_LIFE_PROVIDER,
              purpose: ATTEMPT_PURPOSE,
              state: { in: ['AWAITING_LOGIN', 'AWAITING_MFA'] },
              leaseOwner: input.workerId,
            },
            select: { id: true },
          })
        if (!attempt) {
          throw new Error('National Life attempt completion was rejected')
        }

        await transaction.agentIntegrationSession.upsert({
          where: {
            agentId_deploymentScope_provider_purpose: {
              agentId: input.agentId,
              deploymentScope: env.sessionScopeId,
              provider: NATIONAL_LIFE_PROVIDER,
              purpose: SESSION_PURPOSE,
            },
          },
          create: {
            agentId: input.agentId,
            deploymentScope: env.sessionScopeId,
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
        await transaction.nationalLifeConnectionAttempt.delete({
          where: { id: input.attemptId },
        })
      })
    },

    async releaseLease(attemptId) {
      await prisma.nationalLifeConnectionAttempt.updateMany({
        where: {
          id: attemptId,
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
        },
        data: { leaseOwner: null, leaseExpiresAt: null },
      })
    },
  }
}

function createAttemptRunner(env: NationalLifeEnv) {
  const store = createAttemptStore(env)
  const deps: RunConnectionAttemptDeps = {
    env,
    workerId: env.runtimeWorkerId,
    now: () => new Date(),
    store,
    createInteractiveSession: () => createInteractiveSteelSession(env),
    reconnectSession: (runtime) =>
      reconnectSteelBrowserSession(runtime, env),
    captureContext: (steelSessionId) =>
      captureSteelSessionContext(steelSessionId, env),
    createAdapter: (session) =>
      new NationalLifeAdapter(session, {
        carrierId: NATIONAL_LIFE_PROVIDER,
        loginUrl: env.portalLoginUrl,
        caseSearchUrl: new URL(
          '/cases/search',
          env.portalLoginUrl,
        ).toString(),
        allowedOrigins: env.portalOrigins,
      }),
  }
  return (attemptId: string) =>
    runNationalLifeConnectionAttempt(attemptId, deps).then(() => undefined)
}

function createJobStore(env: NationalLifeEnv): NationalLifeJobStore {
  const service = createBrowserJobService()
  return {
    async claimJob({ jobId }) {
      const job = await prisma.browserAutomationJob.findFirst({
        where: {
          id: jobId,
          provider: NATIONAL_LIFE_PROVIDER,
          state: 'RUNNING',
          leaseOwner: env.runtimeWorkerId,
        },
        select: jobSelect,
      })
      return job ? normalizedJob(job) : null
    },
    transitionJob: (input) => service.transitionJob(input),
  }
}

function createSessionStore(env: NationalLifeEnv) {
  return {
    async findForAgent(agentId: string, provider: string) {
      const stored = await prisma.agentIntegrationSession.findUnique({
        where: {
          agentId_deploymentScope_provider_purpose: {
            agentId,
            deploymentScope: env.sessionScopeId,
            provider,
            purpose: SESSION_PURPOSE,
          },
        },
        select: integrationSessionSelect,
      })
      return stored as StoredAgentIntegrationSession | null
    },
    async markUsed(sessionId: string, usedAt: Date) {
      await prisma.agentIntegrationSession.updateMany({
        where: {
          id: sessionId,
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: SESSION_PURPOSE,
          status: 'CONNECTED',
        },
        data: { lastUsedAt: usedAt },
      })
    },
    async invalidate(agentId: string, provider: string) {
      await prisma.agentIntegrationSession.updateMany({
        where: {
          agentId,
          deploymentScope: env.sessionScopeId,
          provider,
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
    },
  }
}

/// A client that owns exactly one connection, for holding the carrier browser
/// lock.
///
/// The pool size is the point, not an optimisation. A Postgres advisory lock
/// belongs to the connection that took it, and Prisma hands any pooled
/// connection to any query — with a default pool, `pg_advisory_unlock` can run
/// on a connection that never held the lock, and the release silently does
/// nothing. At one connection there is nowhere else for it to go.
///
/// It also keeps the cost honest: the server allows 100 connections and a
/// default Prisma pool would claim roughly a tenth of them per job.
function createLockClient(): PrismaClient {
  const url = new URL(process.env.DATABASE_URL ?? '')
  url.searchParams.set('connection_limit', '1')
  return new PrismaClient({ datasourceUrl: url.toString() })
}

function createJobRunner(env: NationalLifeEnv) {
  const jobStore = createJobStore(env)
  const sessionStore = createSessionStore(env)
  return (jobId: string) =>
    runNationalLifeJob(jobId, {
      env,
      workerId: env.runtimeWorkerId,
      now: () => new Date(),
      jobStore,
      sessionStore,
      createSession: (sessionContext) =>
        createSteelBrowserSession(env, { sessionContext }),
      createAdapter: (session) =>
        new NationalLifeAdapter(session, {
          carrierId: NATIONAL_LIFE_PROVIDER,
          loginUrl: env.portalLoginUrl,
          caseSearchUrl: new URL(
            '/cases/search',
            env.portalLoginUrl,
          ).toString(),
          allowedOrigins: env.portalOrigins,
        }),
      // A fresh single-connection client per job, closed when the job ends, so
      // the advisory lock cannot outlive the work that took it. The worker
      // process never exits, so a leaked lock here would be permanent.
      runExclusively: (work) => withOwnedBrowserLockWaiting(createLockClient, work),
      saveIllustration: (input) => saveRapidSolveIllustration(input, prisma),
      // Guarded on the row still existing: the agent can delete a quote while
      // the carrier is still rendering it, and an update that matches nothing
      // is the right outcome there, not a failed job.
      saveIllustrationDocument: async (input) => {
        await prisma.illustration.updateMany({
          where: { id: input.illustrationId },
          data: {
            // Prisma wants a plain Uint8Array; a Node Buffer is one, but its
            // backing store is typed loosely enough that the compiler will not
            // take it as given.
            documentBytes: new Uint8Array(input.bytes),
            documentMimeType: input.mimeType,
            documentFetchedAt: input.fetchedAt,
          },
        })
      },
      applyCaseObservation,
    }).then(() => undefined)
}

function createViewerDeps(
  env: NationalLifeEnv,
): NationalLifeViewerBrokerDeps {
  return {
    env: {
      signingKey: env.viewerSigningKey,
      appOrigins: env.viewerAppOrigins,
    },
    now: () => new Date(),
    store: {
      async consumeBootstrapNonce(input) {
        const updated =
          await prisma.nationalLifeConnectionAttempt.updateMany({
            where: {
              id: input.attemptId,
              agentId: input.agentId,
              deploymentScope: env.sessionScopeId,
              provider: NATIONAL_LIFE_PROVIDER,
              purpose: ATTEMPT_PURPOSE,
              state: { in: ['AWAITING_LOGIN', 'AWAITING_MFA'] },
              expiresAt: { gt: input.now },
              viewerNonceHash: input.nonceHash,
            },
            data: { viewerNonceHash: null },
          })
        return updated.count === 1
      },
      async getOwnedAttemptRuntime(input) {
        const attempt =
          await prisma.nationalLifeConnectionAttempt.findFirst({
            where: {
              id: input.attemptId,
              agentId: input.agentId,
              deploymentScope: env.sessionScopeId,
              provider: NATIONAL_LIFE_PROVIDER,
              purpose: ATTEMPT_PURPOSE,
            },
            select: {
              state: true,
              expiresAt: true,
              runtimeKeyVersion: true,
              runtimeAlgorithm: true,
              runtimeIv: true,
              runtimeCiphertext: true,
              runtimeAuthTag: true,
            },
          })
        if (!attempt) {
          return null
        }
        const encryptedRuntime =
          attempt.runtimeKeyVersion &&
          attempt.runtimeAlgorithm === 'aes-256-gcm' &&
          attempt.runtimeIv &&
          attempt.runtimeCiphertext &&
          attempt.runtimeAuthTag
            ? ({
                keyVersion: attempt.runtimeKeyVersion,
                algorithm: 'aes-256-gcm',
                iv: attempt.runtimeIv,
                ciphertext: attempt.runtimeCiphertext,
                authTag: attempt.runtimeAuthTag,
              } satisfies EncryptedBrowserSecret)
            : undefined
        return {
          state: attempt.state,
          expiresAt: attempt.expiresAt,
          encryptedRuntime,
        }
      },
    },
    decryptRuntime(encrypted, ownership) {
      return decryptAttemptRuntime(
        encrypted,
        {
          agentId: ownership.agentId,
          scopeId: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: 'INTERACTIVE_ATTEMPT_RUNTIME',
          formatVersion: 1,
        },
        env.sessionKeys,
      )
    },
  }
}

function listen(server: Server, host: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('listening', handleListening)
      reject(error)
    }
    const handleListening = () => {
      server.off('error', handleError)
      resolve()
    }
    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(port, host)
  })
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function createNationalLifeRuntimeDeps(
  env: NationalLifeEnv,
): RuntimeDeps {
  const jobService = createBrowserJobService()
  return {
    viewer: createViewerDeps(env),
    listen: (server) => listen(server, env.viewerBindHost, env.viewerPort),
    closeServer,
    async claimConnectionAttempt() {
      return prisma.nationalLifeConnectionAttempt.findFirst({
        where: {
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          state: { in: getClaimableConnectionAttemptStates() },
          OR: [
            { leaseOwner: null },
            { leaseExpiresAt: { lte: new Date() } },
          ],
        },
        select: { id: true },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      })
    },
    runConnectionAttempt: createAttemptRunner(env),
    claimBrowserJob: () =>
      jobService.claimNextJob(env.runtimeWorkerId),
    runBrowserJob: createJobRunner(env),
    async cleanupLeasedInteractiveAttempts() {
      await prisma.nationalLifeConnectionAttempt.updateMany({
        where: {
          deploymentScope: env.sessionScopeId,
          provider: NATIONAL_LIFE_PROVIDER,
          purpose: ATTEMPT_PURPOSE,
          leaseOwner: env.runtimeWorkerId,
        },
        data: { leaseOwner: null, leaseExpiresAt: null },
      })
    },
    logError(context) {
      console.error(JSON.stringify(context))
    },
  }
}
