import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import type { EncryptedBrowserSecret } from './browser-context-crypto'
import {
  cancelConnectionAttempt,
  completeConnectionAttempt,
  consumeViewerNonce,
  disconnectAgentSession,
  getAgentSessionSummary,
  getOwnedAttemptStatus,
  issueViewerBootstrap,
  listAgentSessionHealthForAdmin,
  startConnectionAttempt,
  type InteractiveConnectionRepository,
  type StoredConnectionAttempt,
  type StoredIntegrationSession,
} from './interactive-connection-service'
import {
  NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS,
  NATIONAL_LIFE_CONNECTION_RATE_LIMIT,
} from './constants'

const now = new Date('2026-07-28T12:00:00.000Z')
const encrypted: EncryptedBrowserSecret = {
  algorithm: 'aes-256-gcm',
  keyVersion: 'v1',
  iv: Buffer.alloc(12, 1).toString('base64'),
  ciphertext: Buffer.from('encrypted-context').toString('base64'),
  authTag: Buffer.alloc(16, 2).toString('base64'),
}

function createMemoryRepository() {
  const attempts = new Map<string, StoredConnectionAttempt>()
  const sessions = new Map<string, StoredIntegrationSession>()
  const auditEvents: Array<{
    action: string
    userId: string
    entityId: string
    result: string
    createdAt: Date
  }> = []
  const calls: string[] = []
  let nextId = 1

  const attemptKey = (agentId: string) => `${agentId}:NATIONAL_LIFE`
  const sessionKey = (agentId: string) => `${agentId}:NATIONAL_LIFE`

  const repository: InteractiveConnectionRepository = {
    async findActiveAttempt(agentId, provider) {
      return attempts.get(`${agentId}:${provider}`) ?? null
    },
    async createAttemptWithAudit(input) {
      const key = attemptKey(input.agentId)
      const current = attempts.get(key)
      if (current) {
        if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(current.state)) {
          attempts.delete(key)
        } else {
          return current.expiresAt > input.now
            ? { kind: 'CONFLICT' as const }
            : { kind: 'BLOCKED_EXPIRED' as const }
        }
      }

      const recentStarts = auditEvents.filter(
        (event) =>
          event.action === 'NATIONAL_LIFE_CONNECTION_STARTED' &&
          event.userId === input.userId &&
          event.createdAt >= input.rateWindowStartedAt,
      )
      if (recentStarts.length >= input.rateLimit) {
        return { kind: 'RATE_LIMITED' as const }
      }

      const attempt: StoredConnectionAttempt = {
        id: `attempt-${nextId++}`,
        agentId: input.agentId,
        provider: 'NATIONAL_LIFE',
        state: 'OPENING_PORTAL',
        formatVersion: 1,
        runtimeKeyVersion: null,
        runtimeAlgorithm: null,
        runtimeIv: null,
        runtimeCiphertext: null,
        runtimeAuthTag: null,
        viewerNonceHash: null,
        currentOrigin: null,
        safeErrorCode: null,
        expiresAt: input.expiresAt,
      }
      attempts.set(key, attempt)
      auditEvents.push({
        action: 'NATIONAL_LIFE_CONNECTION_STARTED',
        userId: input.userId,
        entityId: attempt.id,
        result: 'STARTED',
        createdAt: input.now,
      })
      return { kind: 'CREATED' as const, attempt }
    },
    async findOwnedAttempt(agentId, provider, attemptId) {
      const attempt = attempts.get(`${agentId}:${provider}`)
      return attempt?.id === attemptId ? attempt : null
    },
    async storeViewerNonce(input) {
      const attempt = attempts.get(attemptKey(input.agentId))
      if (
        !attempt ||
        attempt.id !== input.attemptId ||
        !['AWAITING_LOGIN', 'AWAITING_MFA'].includes(attempt.state)
      ) {
        return false
      }
      attempt.viewerNonceHash = input.nonceHash
      return true
    },
    async consumeViewerNonce(input) {
      const attempt = attempts.get(attemptKey(input.agentId))
      if (
        !attempt ||
        attempt.id !== input.attemptId ||
        attempt.viewerNonceHash !== input.nonceHash
      ) {
        return false
      }
      attempt.viewerNonceHash = null
      return true
    },
    async cancelOwnedAttempt(input) {
      const attempt = attempts.get(attemptKey(input.agentId))
      if (!attempt || attempt.id !== input.attemptId) {
        return false
      }
      attempt.state = 'CANCELLED'
      auditEvents.push({
        action: 'NATIONAL_LIFE_CONNECTION_CANCELLED',
        userId: input.userId,
        entityId: input.attemptId,
        result: 'CANCELLED',
        createdAt: input.now,
      })
      return true
    },
    async completeOwnedAttempt(input) {
      const attempt = attempts.get(attemptKey(input.agentId))
      if (!attempt || attempt.id !== input.attemptId) {
        return false
      }
      calls.push('session:commit')
      sessions.set(sessionKey(input.agentId), {
        id: 'session-1',
        agentId: input.agentId,
        agentName: 'Agent One',
        provider: 'NATIONAL_LIFE',
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
      illustrationSsoReachable: null,
      illustrationSsoCheckedAt: null,
      })
      calls.push('attempt:delete')
      attempts.delete(attemptKey(input.agentId))
      return true
    },
    async invalidateOwnedSession(input) {
      const session = sessions.get(sessionKey(input.agentId))
      if (!session) return false
      Object.assign(session, {
        status: 'SESSION_EXPIRED',
        keyVersion: null,
        algorithm: null,
        iv: null,
        ciphertext: null,
        authTag: null,
      })
      return true
    },
    async disconnectOwnedAgent(input) {
      const attempt = attempts.get(attemptKey(input.agentId))
      if (attempt) {
        attempt.state = 'CANCELLED'
      }
      sessions.delete(sessionKey(input.agentId))
      return { attemptCancelled: Boolean(attempt), sessionDeleted: true }
    },
    async findOwnedSession(agentId, provider) {
      return sessions.get(`${agentId}:${provider}`) ?? null
    },
    async listSessionHealth(provider) {
      return [...sessions.values()].filter((session) => session.provider === provider)
    },
  }

  return { repository, attempts, sessions, auditEvents, calls }
}

function deps(repository: InteractiveConnectionRepository) {
  return {
    repository,
    now: () => now,
    config: {
      interactiveLoginEnabled: true,
      interactiveLoginAgentIds: new Set<string>(),
      interactiveLoginAllAgents: true,
      viewerPublicOrigin: 'https://viewer.keepr.one',
      viewerSigningKey: Buffer.alloc(32, 9),
    },
  }
}

describe('National Life owned interactive connection service', () => {
  it('creates only one active attempt for the exact agent/provider', async () => {
    const memory = createMemoryRepository()

    const first = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    const second = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )

    expect(first.kind).toBe('STARTED')
    expect(second).toEqual({ kind: 'EXISTING', attempt: first.kind === 'STARTED' ? first.attempt : null })
    expect(memory.attempts).toHaveLength(1)
  })

  it('returns an existing unexpired attempt instead of creating a second Steel session', async () => {
    const memory = createMemoryRepository()
    const first = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )

    expect(await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )).toEqual({
      kind: 'EXISTING',
      attempt: first.kind === 'STARTED' ? first.attempt : null,
    })
    expect(memory.auditEvents).toHaveLength(1)
  })

  it('preserves a terminal status until the next start replaces it atomically', async () => {
    const memory = createMemoryRepository()
    const first = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (first.kind !== 'STARTED') throw new Error('expected started attempt')
    memory.attempts.get('agent-1:NATIONAL_LIFE')!.state = 'FAILED'
    memory.attempts.get('agent-1:NATIONAL_LIFE')!.safeErrorCode =
      'INTERACTIVE_CONNECTION_FAILED'

    await expect(
      getOwnedAttemptStatus('agent-1', first.attempt.id, deps(memory.repository)),
    ).resolves.toMatchObject({
      id: first.attempt.id,
      state: 'FAILED',
      safeErrorCode: 'INTERACTIVE_CONNECTION_FAILED',
    })

    const replacement = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    expect(replacement).toMatchObject({
      kind: 'STARTED',
      attempt: { state: 'OPENING_PORTAL' },
    })
    expect(
      memory.attempts.get('agent-1:NATIONAL_LIFE')?.id,
    ).not.toBe(first.attempt.id)
    expect(memory.auditEvents).toHaveLength(2)
    expect(memory.auditEvents.every((event) => event.entityId)).toBe(true)
  })

  it('rejects another agent reading or cancelling an attempt', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')

    await expect(
      getOwnedAttemptStatus('agent-2', started.attempt.id, deps(memory.repository)),
    ).rejects.toThrow('National Life connection attempt not found')
    await expect(
      cancelConnectionAttempt(
        { agentId: 'agent-2', userId: 'user-2', attemptId: started.attempt.id },
        deps(memory.repository),
      ),
    ).rejects.toThrow('National Life connection attempt not found')
  })

  it('limits starts to five audit events per fifteen minutes', async () => {
    const memory = createMemoryRepository()

    for (let index = 0; index < NATIONAL_LIFE_CONNECTION_RATE_LIMIT; index += 1) {
      const result = await startConnectionAttempt(
        { agentId: `agent-${index}`, userId: 'user-1' },
        deps(memory.repository),
      )
      expect(result.kind).toBe('STARTED')
    }

    await expect(startConnectionAttempt(
      { agentId: 'agent-over-limit', userId: 'user-1' },
      deps(memory.repository),
    )).resolves.toEqual({ kind: 'RATE_LIMITED' })
  })

  it('consumes a viewer nonce exactly once', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')
    memory.attempts.get('agent-1:NATIONAL_LIFE')!.state = 'AWAITING_LOGIN'

    const bootstrap = await issueViewerBootstrap(
      { agentId: 'agent-1', attemptId: started.attempt.id },
      deps(memory.repository),
    )
    const ticket = new URL(bootstrap.bootstrapUrl).searchParams.get('ticket')
    expect(ticket).toBeTruthy()

    expect(await consumeViewerNonce(
      { agentId: 'agent-1', attemptId: started.attempt.id, ticket: ticket! },
      deps(memory.repository),
    )).toMatchObject({ agentId: 'agent-1', attemptId: started.attempt.id })
    await expect(consumeViewerNonce(
      { agentId: 'agent-1', attemptId: started.attempt.id, ticket: ticket! },
      deps(memory.repository),
    )).rejects.toThrow('Invalid viewer token')
  })

  it('commits encrypted session context before removing the attempt', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')

    await completeConnectionAttempt(
      {
        agentId: 'agent-1',
        attemptId: started.attempt.id,
        encryptedContext: encrypted,
        carrierExpiresAt: null,
      },
      deps(memory.repository),
    )

    expect(memory.calls).toEqual(['session:commit', 'attempt:delete'])
    expect(memory.sessions.get('agent-1:NATIONAL_LIFE')?.ciphertext).toBe(encrypted.ciphertext)
    expect(memory.attempts).toHaveLength(0)
  })

  it('disconnects only the owning agent session and cancels that agent attempt', async () => {
    const memory = createMemoryRepository()
    for (const agentId of ['agent-1', 'agent-2']) {
      const started = await startConnectionAttempt(
        { agentId, userId: `user-${agentId}` },
        deps(memory.repository),
      )
      if (started.kind !== 'STARTED') throw new Error('expected started attempt')
      await completeConnectionAttempt(
        { agentId, attemptId: started.attempt.id, encryptedContext: encrypted, carrierExpiresAt: null },
        deps(memory.repository),
      )
      await startConnectionAttempt(
        { agentId, userId: `user-${agentId}` },
        deps(memory.repository),
      )
    }

    await disconnectAgentSession(
      { agentId: 'agent-1', userId: 'user-agent-1' },
      deps(memory.repository),
    )

    expect(memory.sessions.has('agent-1:NATIONAL_LIFE')).toBe(false)
    expect(memory.sessions.has('agent-2:NATIONAL_LIFE')).toBe(true)
    expect(memory.attempts.get('agent-1:NATIONAL_LIFE')?.state).toBe('CANCELLED')
    expect(memory.attempts.get('agent-2:NATIONAL_LIFE')?.state).toBe('OPENING_PORTAL')
  })

  it('returns summaries without ciphertext, runtime, nonce, debug URL, or Steel id', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')
    await completeConnectionAttempt(
      { agentId: 'agent-1', attemptId: started.attempt.id, encryptedContext: encrypted, carrierExpiresAt: null },
      deps(memory.repository),
    )

    const summary = await getAgentSessionSummary('agent-1', deps(memory.repository))
    expect(summary).toEqual({
      provider: 'NATIONAL_LIFE',
      status: 'CONNECTED',
      lastConnectedAt: now,
      lastUsedAt: null,
      carrierExpiresAt: null,
      illustrationSsoReachable: null,
      illustrationSsoCheckedAt: null,
    })
    expect(JSON.stringify(summary)).not.toMatch(/cipher|runtime|nonce|debug|steel/i)
  })

  it('returns admin health rows without ciphertext or viewer access', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')
    await completeConnectionAttempt(
      { agentId: 'agent-1', attemptId: started.attempt.id, encryptedContext: encrypted, carrierExpiresAt: null },
      deps(memory.repository),
    )

    const health = await listAgentSessionHealthForAdmin(deps(memory.repository))
    expect(health).toEqual([{
      agentId: 'agent-1',
      agentName: 'Agent One',
      status: 'CONNECTED',
      lastConnectedAt: now,
      lastUsedAt: null,
      carrierExpiresAt: null,
      illustrationSsoReachable: null,
      illustrationSsoCheckedAt: null,
    }])
    expect(JSON.stringify(health)).not.toMatch(/cipher|viewer|token|debug|steel/i)
  })

  it('uses the exact ten-minute attempt TTL', async () => {
    const memory = createMemoryRepository()
    const started = await startConnectionAttempt(
      { agentId: 'agent-1', userId: 'user-1' },
      deps(memory.repository),
    )
    if (started.kind !== 'STARTED') throw new Error('expected started attempt')
    expect(started.attempt.expiresAt.getTime() - now.getTime()).toBe(
      NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS,
    )
  })
})
