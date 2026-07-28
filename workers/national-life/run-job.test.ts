import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { encryptCredential } from '../../lib/national-life/credential-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { BrowserJobRecord } from '../../lib/national-life/job-service'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import { encryptMfaContinuation } from '../../lib/national-life/continuation-crypto'
import type { BrowserSession, NationalLifeCaseObservation, NationalLifeCredentials } from './types'
import {
  releaseNationalLifeMfaContinuation,
  runNationalLifeJob,
  type NationalLifeJobStore,
  type StoredNationalLifeCredential,
} from './run-job'

const key = randomBytes(32).toString('base64')
const now = new Date('2026-07-27T12:00:00.000Z')

function buildEnv(): NationalLifeEnv {
  return {
    steelBaseUrl: 'https://steel.example',
    steelApiKey: 'steel-key',
    portalOrigins: ['https://agent.nationallife.example'],
    portalLoginUrl: 'https://agent.nationallife.example/login',
    credentialScopeId: 'scope-1',
    credentialKeyVersion: 'v1',
    credentialKeys: { v1: key },
  }
}

function buildJob(overrides: Partial<BrowserJobRecord> = {}): BrowserJobRecord {
  return {
    id: overrides.id ?? 'job-1',
    agentId: overrides.agentId ?? 'agent-1',
    caseId: overrides.caseId ?? 'case-1',
    provider: overrides.provider ?? 'NATIONAL_LIFE',
    operation: overrides.operation ?? 'SYNC_CASE_READ',
    state: overrides.state ?? 'QUEUED',
    idempotencyKey: overrides.idempotencyKey ?? 'key-1',
    input:
      overrides.input ??
      ({
        caseId: 'case-1',
        applicationId: 'app-1',
        lookup: { kind: 'EXTERNAL_ID', value: 'NLG-TEST-1001' },
      } satisfies BrowserJobRecord['input']),
    result: overrides.result ?? null,
    safeErrorCode: overrides.safeErrorCode ?? null,
    safeErrorDetail: overrides.safeErrorDetail ?? null,
    attemptCount: overrides.attemptCount ?? 1,
    availableAt: overrides.availableAt ?? now,
    leaseOwner: overrides.leaseOwner ?? null,
    leaseExpiresAt: overrides.leaseExpiresAt ?? null,
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    continuationKeyVersion: overrides.continuationKeyVersion ?? null,
    continuationIv: overrides.continuationIv ?? null,
    continuationCiphertext: overrides.continuationCiphertext ?? null,
    continuationAuthTag: overrides.continuationAuthTag ?? null,
    continuationExpiresAt: overrides.continuationExpiresAt ?? null,
  }
}

function buildCredential(password = 'super-secret-password'): StoredNationalLifeCredential {
  const encrypted = encryptCredential(
    { username: 'producer-100', password },
    { agentId: 'agent-1', scopeId: 'scope-1', provider: 'NATIONAL_LIFE' },
    { version: 'v1', base64Key: key },
  )

  return {
    agentId: 'agent-1',
    provider: 'NATIONAL_LIFE',
    algorithm: encrypted.algorithm,
    keyVersion: encrypted.keyVersion,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    authTag: encrypted.authTag,
  }
}

function createSession(id = 'steel-session-1') {
  const calls: string[] = []
  const session = {
    browser: {},
    context: {},
    page: {},
    steelSessionId: id,
    debugUrl: `https://steel.example/session/${id}`,
    close: vi.fn(async () => {
      calls.push('close')
    }),
    disconnect: vi.fn(async () => {
      calls.push('disconnect')
    }),
  } as unknown as BrowserSession

  return { session, calls }
}

function createStore(seed: BrowserJobRecord): NationalLifeJobStore & {
  transitions: Array<{
    from: BrowserJobState
    to: BrowserJobState
    result?: unknown
    safeErrorCode?: string
    safeErrorDetail?: unknown
    availableAt?: Date
  }>
  current(): BrowserJobRecord
} {
  let job = structuredClone(seed)
  const transitions: ReturnType<typeof createStore>['transitions'] = []

  return {
    transitions,
    current: () => structuredClone(job),
    async claimJob({ jobId }) {
      if (job.id !== jobId || job.state !== 'QUEUED') {
        return null
      }

      job = {
        ...job,
        state: 'RUNNING',
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date('2026-07-27T12:06:00.000Z'),
        attemptCount: job.attemptCount + 1,
      }

      return structuredClone(job)
    },
    async transitionJob(input) {
      transitions.push(input)
      job = {
        ...job,
        state: input.to,
        result: input.result ?? null,
        safeErrorCode: input.safeErrorCode ?? null,
        safeErrorDetail: input.safeErrorDetail ?? null,
        availableAt: input.availableAt ?? job.availableAt,
        continuationKeyVersion: input.continuation?.keyVersion ?? null,
        continuationIv: input.continuation?.iv ?? null,
        continuationCiphertext: input.continuation?.ciphertext ?? null,
        continuationAuthTag: input.continuation?.authTag ?? null,
        continuationExpiresAt: input.continuationExpiresAt ?? null,
      }
    },
    async clearContinuation(jobId) {
      if (job.id !== jobId) {
        return
      }

      job = {
        ...job,
        continuationKeyVersion: null,
        continuationIv: null,
        continuationCiphertext: null,
        continuationAuthTag: null,
        continuationExpiresAt: null,
      }
    },
  }
}

function createDeps(options: {
  job?: BrowserJobRecord
  credential?: StoredNationalLifeCredential | null
  login?: (credentials: NationalLifeCredentials) => Promise<{ kind: 'CONNECTED' } | { kind: 'MFA_REQUIRED'; resumeHint: string }>
  readCase?: () => Promise<NationalLifeCaseObservation>
  createSessionId?: string
  reconnectSession?: BrowserSession
  applyCaseObservation?: () => Promise<{ changed: boolean; requirementChanges: number; communicationChanges: number }>
}) {
  const store = createStore(options.job ?? buildJob())
  const created = createSession(options.createSessionId)
  const calls: string[] = []

  return {
    store,
    calls,
    sessionCalls: created.calls,
    deps: {
      env: buildEnv(),
      workerId: 'worker-1',
      now: () => now,
      jobStore: store,
      credentialStore: {
        findForAgent: async () => {
          calls.push('credential:find')
          return options.credential === undefined ? buildCredential() : options.credential
        },
      },
      createSession: async () => {
        calls.push('session:create')
        return created.session
      },
      reconnectSession: async () => {
        calls.push('session:reconnect')
        return options.reconnectSession ?? createSession('steel-session-resumed').session
      },
      createAdapter: (session: BrowserSession) => ({
        login: async (credentials: NationalLifeCredentials): Promise<{ kind: 'CONNECTED' } | { kind: 'MFA_REQUIRED'; resumeHint: string }> => {
          calls.push(`adapter:login:${credentials.username}`)
          return options.login?.(credentials) ?? { kind: 'CONNECTED' }
        },
        readCase: async () => {
          calls.push(`adapter:read:${session.steelSessionId}`)
          return (
            options.readCase?.() ?? {
              externalApplicationId: 'NLG-TEST-1001',
              carrierStatus: 'Underwriting',
              observedAt: '2026-07-27T12:00:00.000Z',
              requirements: [],
              communications: [],
              documents: [],
            }
          )
        },
      }),
      applyCaseObservation: async () => {
        calls.push('sync:apply')
        return (
          options.applyCaseObservation?.() ?? {
            changed: true,
            requirementChanges: 1,
            communicationChanges: 0,
          }
        )
      },
    },
  }
}

describe('National Life run-job orchestration', () => {
  it('decrypts only after claiming an authorized job', async () => {
    const { deps, calls } = createDeps({})

    await runNationalLifeJob('job-1', deps)

    expect(calls.slice(0, 3)).toEqual(['credential:find', 'session:create', 'adapter:login:producer-100'])
  })

  it('does not decrypt credentials when the job is not claimed', async () => {
    const { deps, calls } = createDeps({ job: buildJob({ state: 'RUNNING' }) })

    await expect(runNationalLifeJob('job-1', deps)).resolves.toEqual({ kind: 'NOT_CLAIMED' })
    expect(calls).toEqual([])
  })

  it('closes the browser session after success', async () => {
    const { deps, sessionCalls } = createDeps({})

    await runNationalLifeJob('job-1', deps)

    expect(sessionCalls).toEqual(['close'])
  })

  it('closes the browser session after adapter failure', async () => {
    const { deps, sessionCalls, store } = createDeps({
      readCase: async () => {
        const error = new Error('layout changed with super-secret-password')
        ;(error as Error & { code: string }).code = 'PORTAL_LAYOUT_CHANGED'
        ;(error as Error & { safeDetail: unknown }).safeDetail = { selector: 'missing', password: 'super-secret-password' }
        throw error
      },
    })

    await runNationalLifeJob('job-1', deps)

    expect(sessionCalls).toEqual(['close'])
    expect(store.transitions.at(-1)).toMatchObject({
      to: 'MANUAL_REVIEW',
      safeErrorCode: 'PORTAL_LAYOUT_CHANGED',
    })
  })

  it('moves an MFA response to WAITING_FOR_MFA', async () => {
    const { deps, store } = createDeps({
      login: async () => ({ kind: 'MFA_REQUIRED', resumeHint: 'Complete MFA.' }),
    })

    await runNationalLifeJob('job-1', deps)

    expect(store.transitions.at(-1)).toMatchObject({
      to: 'WAITING_FOR_MFA',
      result: {
        resumeHint: 'Complete MFA.',
        continuationExpiresAt: '2026-07-27T12:05:00.000Z',
      },
    })
  })

  it('encrypts the Steel continuation and disconnects without releasing the MFA session', async () => {
    const { deps, store, sessionCalls } = createDeps({
      login: async () => ({ kind: 'MFA_REQUIRED', resumeHint: 'Complete MFA.' }),
    })

    await runNationalLifeJob('job-1', deps)

    const paused = store.current()
    expect(paused.continuationKeyVersion).toBe('v1')
    expect(paused.continuationCiphertext).not.toContain('steel-session-1')
    expect(sessionCalls).toEqual(['disconnect'])
  })

  it('reconnects the same Steel session after owner resume', async () => {
    const encrypted = encryptMfaContinuation(
      {
        steelSessionId: 'steel-session-paused',
        debugUrl: 'https://steel.example/session/paused',
        expiresAt: '2026-07-27T12:05:00.000Z',
      },
      { agentId: 'agent-1', jobId: 'job-1', scopeId: 'scope-1' },
      { version: 'v1', base64Key: key },
    )
    const resumed = createSession('steel-session-paused')
    const { deps, calls } = createDeps({
      job: buildJob({
        continuationKeyVersion: encrypted.keyVersion,
        continuationIv: encrypted.iv,
        continuationCiphertext: encrypted.ciphertext,
        continuationAuthTag: encrypted.authTag,
        continuationExpiresAt: new Date('2026-07-27T12:05:00.000Z'),
      }),
      reconnectSession: resumed.session,
    })

    await runNationalLifeJob('job-1', deps)

    expect(calls).toEqual(['session:reconnect', 'adapter:read:steel-session-paused', 'sync:apply'])
  })

  it('releases an expired or cancelled MFA session and clears the continuation', async () => {
    const encrypted = encryptMfaContinuation(
      {
        steelSessionId: 'steel-session-paused',
        debugUrl: 'https://steel.example/session/paused',
        expiresAt: '2026-07-27T11:59:00.000Z',
      },
      { agentId: 'agent-1', jobId: 'job-1', scopeId: 'scope-1' },
      { version: 'v1', base64Key: key },
    )
    const store = createStore(
      buildJob({
        state: 'CANCELLED',
        continuationKeyVersion: encrypted.keyVersion,
        continuationIv: encrypted.iv,
        continuationCiphertext: encrypted.ciphertext,
        continuationAuthTag: encrypted.authTag,
        continuationExpiresAt: new Date('2026-07-27T11:59:00.000Z'),
      }),
    )
    const session = createSession('steel-session-paused')

    await releaseNationalLifeMfaContinuation(store.current(), {
      env: buildEnv(),
      now: () => now,
      jobStore: store,
      reconnectSession: async () => session.session,
    })

    expect(session.calls).toEqual(['close'])
    expect(store.current().continuationCiphertext).toBeNull()
  })

  it('marks rejected credentials CREDENTIALS_EXPIRED', async () => {
    const { deps, store } = createDeps({
      login: async () => {
        const error = new Error('login failed')
        ;(error as Error & { code: string }).code = 'AUTHENTICATION_STATE_INVALID'
        throw error
      },
    })

    await runNationalLifeJob('job-1', deps)

    expect(store.transitions.at(-1)).toMatchObject({
      to: 'CREDENTIALS_EXPIRED',
      safeErrorCode: 'CREDENTIALS_EXPIRED',
    })
  })

  it('marks selector/schema drift MANUAL_REVIEW with redacted detail', async () => {
    const { deps, store } = createDeps({
      readCase: async () => {
        const error = new Error('layout changed with super-secret-password')
        ;(error as Error & { code: string }).code = 'PORTAL_LAYOUT_CHANGED'
        ;(error as Error & { safeDetail: unknown }).safeDetail = {
          selector: 'missing',
          password: 'super-secret-password',
        }
        throw error
      },
    })

    await runNationalLifeJob('job-1', deps)

    const detail = JSON.stringify(store.transitions.at(-1)?.safeErrorDetail)
    expect(store.transitions.at(-1)).toMatchObject({ to: 'MANUAL_REVIEW' })
    expect(detail).not.toContain('super-secret-password')
    expect(detail).toContain('[REDACTED]')
  })

  it('marks transient failures RETRYABLE with bounded availableAt', async () => {
    const { deps, store } = createDeps({
      readCase: async () => {
        const error = new Error('temporary network failure')
        ;(error as Error & { code: string }).code = 'ECONNRESET'
        throw error
      },
    })

    await runNationalLifeJob('job-1', deps)

    expect(store.transitions.at(-1)).toMatchObject({
      to: 'RETRYABLE',
      safeErrorCode: 'TRANSIENT_WORKER_FAILURE',
      availableAt: new Date('2026-07-27T12:02:00.000Z'),
    })
  })

  it('applies a case observation before marking SUCCEEDED', async () => {
    const { deps, calls, store } = createDeps({})

    await runNationalLifeJob('job-1', deps)

    expect(calls).toEqual([
      'credential:find',
      'session:create',
      'adapter:login:producer-100',
      'adapter:read:steel-session-1',
      'sync:apply',
    ])
    expect(store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  it('never includes the credential in job result or error', async () => {
    const { deps, store } = createDeps({
      credential: buildCredential('super-secret-password'),
      readCase: async () => {
        throw new Error('super-secret-password')
      },
    })

    await runNationalLifeJob('job-1', deps)

    expect(JSON.stringify(store.current())).not.toContain('super-secret-password')
  })
})
