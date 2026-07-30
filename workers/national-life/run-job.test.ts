import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import { describe, expect, it, vi } from 'vitest'
import { encryptBrowserContext } from '../../lib/national-life/browser-context-crypto'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { BrowserJobRecord } from '../../lib/national-life/job-service'
import type { BrowserJobState } from '../../lib/national-life/job-state'
import type {
  RapidSolveFailure,
  RapidSolveQuote,
  RapidSolveRequest,
} from '../../lib/national-life/rapid-solve'
import type { BrowserSession, NationalLifeCaseObservation } from './types'
import {
  describeUnexpectedFailure,
  runNationalLifeJob,
  type NationalLifeJobStore,
  type StoredAgentIntegrationSession,
} from './run-job'

const key = randomBytes(32).toString('base64')
const now = new Date('2026-07-28T12:00:00.000Z')
const restoredContext: SessionContext = {
  cookies: [
    {
      name: 'carrier-session',
      value: 'opaque-session-value',
      domain: '.nationallife.example',
    },
  ],
}

function buildEnv(): NationalLifeEnv {
  return {
    steelBaseUrl: 'https://steel.example',
    steelApiKey: 'steel-key',
    portalOrigins: ['https://agent.nationallife.example'],
    portalLoginUrl: 'https://agent.nationallife.example/login',
    sessionScopeId: 'scope-1',
    sessionKeyVersion: 'v1',
    sessionKeys: { v1: key },
    viewerSigningKey: Buffer.alloc(32, 2),
    viewerPublicOrigin: 'https://viewer.keepr.one',
    viewerBindHost: '127.0.0.1',
    viewerPort: 3010,
    runtimeWorkerId: 'worker-1',
    interactiveLoginEnabled: true,
    interactiveLoginAgentIds: new Set(['agent-1']),
    interactiveLoginAllAgents: false,
    viewerAppOrigins: ['https://app.keepr.one'],
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

function buildStoredSession(
  overrides: Partial<StoredAgentIntegrationSession> = {},
): StoredAgentIntegrationSession {
  const encrypted = encryptBrowserContext(
    restoredContext,
    {
      agentId: 'agent-1',
      scopeId: 'scope-1',
      provider: 'NATIONAL_LIFE',
      purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
      formatVersion: 1,
    },
    { version: 'v1', base64Key: key },
  )
  return {
    id: 'integration-session-1',
    agentId: 'agent-1',
    provider: 'NATIONAL_LIFE',
    status: 'CONNECTED',
    formatVersion: 1,
    keyVersion: encrypted.keyVersion,
    algorithm: encrypted.algorithm,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    authTag: encrypted.authTag,
    carrierExpiresAt: new Date('2026-07-28T20:00:00.000Z'),
    lastConnectedAt: now,
    lastUsedAt: null,
    ...overrides,
  }
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
        leaseExpiresAt: new Date('2026-07-28T12:06:00.000Z'),
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
      }
    },
  }
}

function createBrowserSession(calls: string[] = []) {
  const close = vi.fn(async () => {
    calls.push('browser:close')
  })
  return {
    session: {
      browser: {},
      context: {},
      page: {},
      steelSessionId: 'steel-session-1',
      debugUrl: 'https://steel.example/internal/session-1',
      close,
      disconnect: vi.fn(),
    } as unknown as BrowserSession,
    close,
  }
}

function createDeps(options: {
  job?: BrowserJobRecord
  storedSession?: StoredAgentIntegrationSession | null
  assertAuthenticated?: () => Promise<void>
  readCase?: () => Promise<NationalLifeCaseObservation>
  requestRapidSolveQuote?: () => Promise<RapidSolveQuote | RapidSolveFailure>
  browserBusy?: boolean
}) {
  const store = createStore(options.job ?? buildJob())
  const calls: string[] = []
  const browser = createBrowserSession(calls)
  const invalidations: Array<{ agentId: string; provider: string }> = []
  const used: Array<{ sessionId: string; usedAt: Date }> = []
  const quoteRequests: RapidSolveRequest[] = []
  const savedIllustrations: Array<{ insuredName: string }> = []

  return {
    calls,
    invalidations,
    used,
    store,
    browser,
    quoteRequests,
    savedIllustrations,
    deps: {
      env: buildEnv(),
      workerId: 'worker-1',
      now: () => now,
      jobStore: store,
      sessionStore: {
        async findForAgent() {
          calls.push('session-store:find')
          return options.storedSession === undefined
            ? buildStoredSession()
            : options.storedSession
        },
        async markUsed(sessionId: string, usedAt: Date) {
          used.push({ sessionId, usedAt })
        },
        async invalidate(agentId: string, provider: string) {
          invalidations.push({ agentId, provider })
        },
      },
      decryptContext(session: StoredAgentIntegrationSession) {
        calls.push('context:decrypt')
        expect(session.id).toBe('integration-session-1')
        return restoredContext
      },
      async createSession(sessionContext: SessionContext) {
        calls.push('steel:create-restored')
        expect(sessionContext).toEqual(restoredContext)
        return browser.session
      },
      createAdapter: () => ({
        async openPortalHome() {
          calls.push('adapter:open-portal')
        },
        async assertAuthenticated() {
          calls.push('adapter:assert-authenticated')
          await options.assertAuthenticated?.()
        },
        async readCase() {
          calls.push('adapter:read')
          return (
            options.readCase?.() ?? {
              externalApplicationId: 'NLG-TEST-1001',
              carrierStatus: 'Underwriting',
              observedAt: '2026-07-28T12:00:00.000Z',
              requirements: [],
              communications: [],
              documents: [],
            }
          )
        },
        async requestRapidSolveQuote(request: RapidSolveRequest) {
          calls.push('adapter:quote')
          quoteRequests.push(request)
          return (
            options.requestRapidSolveQuote?.() ?? {
              ok: true as const,
              faceAmount: 250_000,
              annualPremium: 3_748.8,
              monthlyPremium: 312.4,
              lapseYear: null,
            }
          )
        },
      }),
      async runExclusively<T>(work: () => Promise<T>) {
        calls.push('lock:acquire')
        if (options.browserBusy) {
          return null
        }
        try {
          return await work()
        } finally {
          calls.push('lock:release')
        }
      },
      async saveIllustration(saved: { insuredName: string }) {
        calls.push('illustration:save')
        savedIllustrations.push(saved)
        return { illustrationId: 'illustration-1' }
      },
      async applyCaseObservation() {
        calls.push('sync:apply')
        return {
          changed: true,
          requirementChanges: 1,
          communicationChanges: 0,
        }
      },
    },
  }
}

describe('National Life restored-context job orchestration', () => {
  it('restores an authenticated session before reading and applying carrier data', async () => {
    const test = createDeps({})

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toEqual([
      'session-store:find',
      'context:decrypt',
      'lock:acquire',
      'steel:create-restored',
      // A restored session opens blank; the authentication check reads the
      // page origin, so it has to be on the carrier's site first.
      'adapter:open-portal',
      'adapter:assert-authenticated',
      'adapter:read',
      'sync:apply',
      'browser:close',
      'lock:release',
    ])
    expect(test.used).toEqual([
      { sessionId: 'integration-session-1', usedAt: now },
    ])
    expect(test.store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
    expect(test.browser.close).toHaveBeenCalledOnce()
  })

  it('does not restore context before the job is claimed', async () => {
    const test = createDeps({ job: buildJob({ state: 'RUNNING' }) })

    await expect(runNationalLifeJob('job-1', test.deps)).resolves.toEqual({
      kind: 'NOT_CLAIMED',
    })
    expect(test.calls).toEqual([])
  })

  it.each([
    ['missing', null],
    [
      'expired',
      buildStoredSession({
        carrierExpiresAt: new Date('2026-07-28T11:59:59.000Z'),
      }),
    ],
    [
      'incomplete',
      buildStoredSession({
        ciphertext: null,
      }),
    ],
  ])(
    'invalidates %s stored context and requests a reconnect',
    async (_label, storedSession) => {
      const test = createDeps({ storedSession })

      await runNationalLifeJob('job-1', test.deps)

      expect(test.invalidations).toEqual([
        { agentId: 'agent-1', provider: 'NATIONAL_LIFE' },
      ])
      expect(test.store.transitions.at(-1)).toMatchObject({
        to: 'ACTION_REQUIRED',
        safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
      })
      expect(test.calls).toEqual(['session-store:find'])
    },
  )

  it('invalidates context when the restored carrier session is not authenticated', async () => {
    const error = Object.assign(new Error('not authenticated'), {
      code: 'AUTHENTICATION_STATE_INVALID',
    })
    const test = createDeps({
      assertAuthenticated: async () => {
        throw error
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.invalidations).toEqual([
      { agentId: 'agent-1', provider: 'NATIONAL_LIFE' },
    ])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'ACTION_REQUIRED',
      safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
    })
    expect(test.browser.close).toHaveBeenCalledOnce()
    expect(test.used).toEqual([])
  })

  it('keeps selector drift in manual review without leaking carrier data', async () => {
    const test = createDeps({
      readCase: async () => {
        const error = Object.assign(new Error('layout changed'), {
          code: 'PORTAL_LAYOUT_CHANGED',
          safeDetail: { selector: 'missing', secret: 'sensitive-value' },
        })
        throw error
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'MANUAL_REVIEW',
      safeErrorCode: 'PORTAL_LAYOUT_CHANGED',
    })
    expect(JSON.stringify(test.store.current())).not.toContain('sensitive-value')
    expect(test.browser.close).toHaveBeenCalledOnce()
  })

  const quoteJobInput = {
    issueState: 'FL',
    firstName: 'Ana',
    lastName: 'Souza',
    dateOfBirth: '03/10/1986',
    gender: 'F',
    rateClass: 'NonTobacco',
    solveType: 'Specify_Amount',
    amount: 250_000,
    deathBenefitOption: 'Level',
    strategy: 'S&P',
    allocation: 100,
    productCode: '956',
  }

  function buildQuoteJob() {
    return buildJob({
      operation: 'GET_RAPID_SOLVE_QUOTE',
      // A prospect has no case.
      caseId: null,
      input: quoteJobInput,
    })
  }

  it('asks the carrier to price the illustration and stores the answer', async () => {
    const test = createDeps({ job: buildQuoteJob() })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toContain('adapter:quote')
    expect(test.calls).not.toContain('adapter:read')
    expect(test.calls).not.toContain('sync:apply')
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'SUCCEEDED',
      result: { ok: true, monthlyPremium: 312.4 },
    })
  })

  it('sends the date and age the carrier expects, through the queue', async () => {
    const test = createDeps({ job: buildQuoteJob() })

    await runNationalLifeJob('job-1', test.deps)

    // Age nearest birthday on 2026-07-28 for a 1986-03-10 birth is 40: the next
    // birthday is further away than the last one. Reading the stored date as
    // local time instead of UTC is what would break this.
    expect(test.quoteRequests.at(-1)).toMatchObject({
      DateOfBirth: '03/10/1986',
      IssueAge: 40,
      ProductCode: '956',
      PremiumMode: 'Monthly',
    })
  })

  // The carrier answers a refusal with HTTP 200 and a sentence. That sentence is
  // the answer, so the job succeeded — it asked and got a reply. Failing here
  // would send the sentence through error redaction and leave the agent with a
  // code instead of a reason.
  it('keeps the priced quote, so closing the tab does not lose it', async () => {
    const test = createDeps({ job: buildQuoteJob() })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.savedIllustrations).toEqual([
      expect.objectContaining({ insuredName: 'Ana Souza', jobId: 'job-1' }),
    ])
  })

  // A refusal is an answer the job keeps, but there is no premium and no face
  // amount to file: a row of zeros would read as a quote of zero.
  it('files no illustration when the carrier refused to quote', async () => {
    const test = createDeps({
      job: buildQuoteJob(),
      requestRapidSolveQuote: async () => ({ ok: false, message: 'Below the minimum.' }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.savedIllustrations).toEqual([])
    expect(test.store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  it('treats a carrier refusal as an answer, not a failed job', async () => {
    const test = createDeps({
      job: buildQuoteJob(),
      requestRapidSolveQuote: async () => ({
        ok: false,
        message: 'Face amount below the product minimum.',
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'SUCCEEDED',
      result: { ok: false, message: 'Face amount below the product minimum.' },
    })
  })

  it('refuses a job whose operation and payload disagree', async () => {
    const test = createDeps({
      job: buildJob({ operation: 'GET_RAPID_SOLVE_QUOTE' }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).not.toContain('steel:create-restored')
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'UNSUPPORTED_JOB_OPERATION',
    })
  })

  // Steel runs one Chrome for this deployment. Before this, the job loop opened
  // a browser without the lock the cron scripts take, so a sync and a job could
  // land on the same Chrome and kill each other mid-navigation.
  it('takes the carrier browser lock before opening a session', async () => {
    const test = createDeps({})

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls.indexOf('lock:acquire')).toBeLessThan(
      test.calls.indexOf('steel:create-restored'),
    )
    expect(test.calls).toContain('lock:release')
  })

  // Releasing while Chrome is still going down lets the next holder build a
  // session on top of this one, which is the failure the lock is for.
  it('closes the carrier browser before releasing the lock', async () => {
    const test = createDeps({})

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls.indexOf('browser:close')).toBeGreaterThan(-1)
    expect(test.calls.indexOf('browser:close')).toBeLessThan(
      test.calls.indexOf('lock:release'),
    )
  })

  it('re-queues rather than fails when another carrier browser holds the lock', async () => {
    const test = createDeps({ browserBusy: true })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).not.toContain('steel:create-restored')
    expect(test.store.transitions.map((transition) => transition.to)).toEqual([
      'RETRYABLE',
      'QUEUED',
    ])
    // Parking it in RETRYABLE would strand it: nothing revives a RETRYABLE job,
    // so it would never be claimed, never fail, and poll as pending forever.
    expect(test.store.current().state).toBe('QUEUED')
    expect(test.store.current().availableAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('says what went wrong when it does not recognise the failure', async () => {
    const test = createDeps({
      assertAuthenticated: async () => {
        throw new Error('connect ECONNREFUSED steel')
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'UNEXPECTED_WORKER_FAILURE',
      safeErrorDetail: { name: 'Error', message: 'connect ECONNREFUSED steel' },
    })
  })

  // These messages routinely carry the session's debug URL inside the sentence,
  // where a redactor keyed on field names cannot see it — and this value is
  // stored and shown.
  it('keeps a session URL out of the stored failure detail', () => {
    const detail = describeUnexpectedFailure(
      new Error('navigation failed at https://steel.internal/session/abc?token=secret'),
    ) as { message: string }

    expect(detail.message).not.toContain('steel.internal')
    expect(detail.message).not.toContain('secret')
    expect(detail.message).toContain('[URL]')
  })

  it('contains no credential-decrypt or credential-object runtime path', async () => {
    const forbidden = [
      `pass${'word'}`,
      `decrypt${'Credential'}`,
      `NationalLife${'Credentials'}`,
    ]
    const sources = await Promise.all([
      readFile(new URL('./run-job.ts', import.meta.url), 'utf8'),
      readFile(new URL('./types.ts', import.meta.url), 'utf8'),
    ])

    for (const source of sources) {
      for (const token of forbidden) {
        expect(source).not.toContain(token)
      }
    }
  })
})
