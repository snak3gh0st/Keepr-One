import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/// `noteForesightReachability` calls `recordForesightReachability` without
/// deps, which resolves to the real prisma-backed repository — same pattern
/// runtime.test.ts uses to intercept a module-level singleton.
const prismaMock = vi.hoisted(() => ({
  agentIntegrationSession: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

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

/// What the browser holds *after* the job — the `auth0` cookie rotated by the
/// SSO crossing, which is the whole reason the context has to be written back.
const capturedContext: SessionContext = {
  cookies: [
    {
      name: 'carrier-session',
      value: 'opaque-session-value',
      domain: '.nationallife.example',
    },
    { name: 'auth0', value: 'rotated-by-the-crossing', domain: '.auth0.example' },
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
    keepAliveSsoJump: false,
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
    liveSteelSessionId: null,
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
  const disconnect = vi.fn(async () => {
    calls.push('browser:disconnect')
  })
  return {
    session: {
      browser: {},
      context: {},
      page: {},
      steelSessionId: 'steel-session-1',
      debugUrl: 'https://steel.example/internal/session-1',
      close,
      disconnect,
    } as unknown as BrowserSession,
    close,
  }
}

function createDeps(options: {
  job?: BrowserJobRecord
  storedSession?: StoredAgentIntegrationSession | null
  assertAuthenticated?: () => Promise<void>
  readCase?: () => Promise<NationalLifeCaseObservation>
  readForesight?: (input: { targetCaseKey?: string }) => Promise<{
    cases: Array<{
      externalKey: string
      displayName: string
      caseKind: string | null
      product: string | null
    }>
    selectedCase: {
      externalKey: string
      displayName: string
      caseKind: string | null
      product: string | null
    } | null
    services: Array<{
      serviceName: string
      payloadShape: unknown
      payload: unknown
      validationState: 'VALID' | 'INVALID'
    }>
  }>
  foresightCase?: {
    id: string
    externalKey: string
    displayName: string
  } | null
  requestRapidSolveQuote?: () => Promise<RapidSolveQuote | RapidSolveFailure>
  renderForesightReport?: (caseKey?: string) => {
    caseName: string
    bytes: Buffer
    mimeType: string
  } | null
  browserBusy?: boolean
  saveContext?: () => void
  reattachError?: Error
}) {
  const store = createStore(options.job ?? buildJob())
  const calls: string[] = []
  const browser = createBrowserSession(calls)
  const invalidations: Array<{ agentId: string; provider: string }> = []
  const used: Array<{ sessionId: string; usedAt: Date }> = []
  const quoteRequests: RapidSolveRequest[] = []
  const savedIllustrations: Array<{ insuredName: string }> = []
  const savedContexts: Array<{ sessionId: string; context: SessionContext }> = []
  const reattached: string[] = []
  const reconciledRuns: string[] = []
  const savedForesightInventories: Array<{
    runId: string
    agentId: string
    deploymentScope: string
    cases: Array<{ externalKey: string }>
  }> = []
  const savedForesightServices: Array<{ caseSnapshotId: string }> = []
  const savedForesightProgress: Array<Record<string, unknown>> = []
  const savedForesightDocuments: Array<{
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
    reportKey: string
  }> = []
  const foresightReadInputs: Array<{ targetCaseKey?: string }> = []
  const foresightReportInputs: Array<string | undefined> = []
  const reconciledForesightRuns: string[] = []

  return {
    calls,
    invalidations,
    used,
    store,
    browser,
    quoteRequests,
    savedIllustrations,
    savedContexts,
    reattached,
    reconciledRuns,
    savedForesightInventories,
    savedForesightServices,
    savedForesightProgress,
    savedForesightDocuments,
    foresightReadInputs,
    foresightReportInputs,
    reconciledForesightRuns,
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
        async saveContext(sessionId: string, context: SessionContext) {
          options.saveContext?.()
          savedContexts.push({ sessionId, context })
        },
      },
      async captureContext(session: BrowserSession) {
        calls.push('context:capture')
        expect(session).toBe(browser.session)
        return capturedContext
      },
      decryptContext(session: StoredAgentIntegrationSession) {
        calls.push('context:decrypt')
        expect(session.id).toBe('integration-session-1')
        return restoredContext
      },
      async reattachSession(steelSessionId: string) {
        calls.push('steel:reattach')
        reattached.push(steelSessionId)
        if (options.reattachError) throw options.reattachError
        return browser.session
      },
      async createSession(sessionContext: SessionContext) {
        calls.push('steel:create-restored')
        expect(sessionContext).toEqual(restoredContext)
        return browser.session
      },
      createAdapter: () => ({
        async readForesight(input: { targetCaseKey?: string }) {
          calls.push('foresight:read')
          foresightReadInputs.push(input)
          return options.readForesight?.(input) ?? {
            cases: [
              {
                externalKey: 'foresight-case-1',
                displayName: 'Foresight case one',
                caseKind: 'CASE',
                product: 'IUL',
              },
            ],
            selectedCase: null,
            services: [],
          }
        },
        async renderForesightReport(caseKey?: string) {
          calls.push('foresight:render')
          foresightReportInputs.push(caseKey)
          return options.renderForesightReport === undefined
            ? { caseName: 'RP-Teste-QQ-1', bytes: Buffer.from('%PDF-1.7'), mimeType: 'application/pdf' }
            : options.renderForesightReport(caseKey)
        },
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
      syncRunStore: {
        async reconcile(runId: string) {
          reconciledRuns.push(runId)
        },
      },
      foresightRunStore: {
        async start() {
          throw new Error('Foresight run start is not used by the worker')
        },
        async findCase() {
          return options.foresightCase ?? null
        },
        async saveInventory(input: {
          runId: string
          agentId: string
          deploymentScope: string
          cases: Array<{ externalKey: string }>
        }) {
          savedForesightInventories.push(input)
          return new Map([['foresight-case-1', 'snapshot-1']])
        },
        async saveService(input: { caseSnapshotId: string }) {
          savedForesightServices.push(input)
        },
        async saveDocument(input: {
          agentId: string
          deploymentScope: string
          caseSnapshotId: string
          reportKey: string
        }) {
          savedForesightDocuments.push(input)
        },
        async updateProgress(input: { patch: Record<string, unknown> }) {
          savedForesightProgress.push(input.patch)
        },
        async reconcile(input: { runId: string }) {
          reconciledForesightRuns.push(input.runId)
        },
        async getStatus() {
          return null
        },
      },
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
      async saveIllustrationDocument() {
        calls.push('illustration:document')
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
  beforeEach(() => {
    prismaMock.agentIntegrationSession.updateMany.mockClear()
  })

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
      // Read while the browser is still up, so an SSO rotation is not lost.
      'context:capture',
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

  it('rejects retired remote grid jobs before opening a browser', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_NATIONAL_LIFE_GRID',
        caseId: null,
        input: { syncRunId: 'run-1', gridKey: 'NEW_BUSINESS' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).not.toContain('adapter:sync-grid')
    expect(test.reconciledRuns).toEqual(['run-1'])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'LOCAL_CONNECTOR_REQUIRED',
    })
    expect(test.calls).not.toContain('session-store:find')
  })

  it('persists every Foresight inventory listing without service observations', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toContain('foresight:read')
    expect(test.savedForesightInventories).toEqual([
      expect.objectContaining({
        runId: 'foresight-run-1',
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        cases: [expect.objectContaining({ externalKey: 'foresight-case-1' })],
      }),
    ])
    expect(test.savedForesightServices).toEqual([])
    expect(test.reconciledForesightRuns).toEqual(['foresight-run-1'])
    expect(test.store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  it('records Foresight as reachable when a Foresight inventory job completes', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(prismaMock.agentIntegrationSession.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', deploymentScope: 'scope-1', provider: 'NATIONAL_LIFE', purpose: 'CARRIER_SESSION' },
      data: { illustrationSsoReachable: true, illustrationSsoCheckedAt: expect.any(Date) },
    })
  })

  it('keeps a Foresight job SUCCEEDED even when the reachability telemetry write fails', async () => {
    prismaMock.agentIntegrationSession.updateMany.mockRejectedValueOnce(new Error('db unavailable'))
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  it('persists one Foresight detail service at a time with progress for the exact owned case', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: {
          foresightRunId: 'foresight-run-1',
          mode: 'DETAIL',
          targetCaseId: 'snapshot-1',
        },
      }),
      foresightCase: {
        id: 'snapshot-1',
        externalKey: 'exact-foresight-case-key',
        displayName: 'Exact Foresight case',
      },
      readForesight: async () => ({
        cases: [],
        selectedCase: {
          externalKey: 'exact-foresight-case-key',
          displayName: 'Exact Foresight case',
          caseKind: 'CASE',
          product: 'IUL',
        },
        services: [
          {
            serviceName: 'WidgetService.asmx/GetQuickCalcData',
            payloadShape: { premium: 'number' },
            payload: { premium: 100 },
            validationState: 'VALID',
          },
          {
            serviceName: 'WidgetService.asmx/GetState',
            payloadShape: { state: 'string(4)' },
            payload: { state: 'OPEN' },
            validationState: 'VALID',
          },
        ],
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.foresightReadInputs).toEqual([
      { targetCaseKey: 'exact-foresight-case-key' },
    ])
    expect(test.savedForesightServices).toEqual([
      expect.objectContaining({
        caseSnapshotId: 'snapshot-1',
        observation: expect.objectContaining({ serviceName: 'WidgetService.asmx/GetQuickCalcData' }),
      }),
      expect.objectContaining({
        caseSnapshotId: 'snapshot-1',
        observation: expect.objectContaining({ serviceName: 'WidgetService.asmx/GetState' }),
      }),
    ])
    expect(test.savedForesightProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ totalServices: 2, completedServices: 0 }),
        expect.objectContaining({ completedServices: 1, currentService: 'WidgetService.asmx/GetQuickCalcData' }),
        expect.objectContaining({ completedServices: 2, currentService: 'WidgetService.asmx/GetState' }),
      ]),
    )
    expect(test.reconciledForesightRuns).toEqual(['foresight-run-1'])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'SUCCEEDED',
      result: { caseSnapshotId: 'snapshot-1', servicesRead: 2 },
    })
  })

  it('rejects an unowned Foresight detail snapshot before opening a browser', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: {
          foresightRunId: 'foresight-run-1',
          mode: 'DETAIL',
          targetCaseId: 'snapshot-missing',
        },
      }),
      foresightCase: null,
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).not.toContain('steel:create-restored')
    expect(test.calls).not.toContain('adapter:open-portal')
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'FORESIGHT_CASE_NOT_FOUND',
    })
    expect(test.reconciledForesightRuns).toEqual(['foresight-run-1'])
  })

  it('persists a Foresight PDF only on the exact owned case snapshot', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_FORESIGHT_PDF',
        caseId: null,
        input: { caseSnapshotId: 'snapshot-1', caseKey: 'exact-foresight-case-key' },
      }),
      foresightCase: {
        id: 'snapshot-1',
        externalKey: 'exact-foresight-case-key',
        displayName: 'Exact Foresight case',
      },
      renderForesightReport: () => ({
        caseName: 'exact-foresight-case-key',
        bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1_025)]),
        mimeType: 'application/pdf',
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.foresightReportInputs).toEqual(['exact-foresight-case-key'])
    expect(test.savedForesightDocuments).toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        caseSnapshotId: 'snapshot-1',
        reportKey: 'foresight-report',
      }),
    ])
    expect(test.calls).not.toContain('illustration:document')
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'SUCCEEDED',
      result: { caseSnapshotId: 'snapshot-1', rendered: true },
    })
  })

  it('records Foresight as reachable when a Foresight PDF job completes', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_FORESIGHT_PDF',
        caseId: null,
        input: { caseSnapshotId: 'snapshot-1', caseKey: 'exact-foresight-case-key' },
      }),
      foresightCase: {
        id: 'snapshot-1',
        externalKey: 'exact-foresight-case-key',
        displayName: 'Exact Foresight case',
      },
      renderForesightReport: () => ({
        caseName: 'exact-foresight-case-key',
        bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1_025)]),
        mimeType: 'application/pdf',
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(prismaMock.agentIntegrationSession.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', deploymentScope: 'scope-1', provider: 'NATIONAL_LIFE', purpose: 'CARRIER_SESSION' },
      data: { illustrationSsoReachable: true, illustrationSsoCheckedAt: expect.any(Date) },
    })
  })

  it('does not record Foresight reachability for non-Foresight operations', async () => {
    const test = createDeps({ job: buildQuoteJob() })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
    expect(prismaMock.agentIntegrationSession.updateMany).not.toHaveBeenCalled()
  })

  it('fails a non-PDF Foresight report without persisting a document', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_FORESIGHT_PDF',
        caseId: null,
        input: { caseSnapshotId: 'snapshot-1', caseKey: 'exact-foresight-case-key' },
      }),
      foresightCase: {
        id: 'snapshot-1',
        externalKey: 'exact-foresight-case-key',
        displayName: 'Exact Foresight case',
      },
      renderForesightReport: () => ({
        caseName: 'exact-foresight-case-key',
        bytes: Buffer.from('<html>carrier error</html>'),
        mimeType: 'text/html',
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.savedForesightDocuments).toEqual([])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'FORESIGHT_REPORT_FAILED',
    })
  })

  it('rejects a Foresight PDF rendered for a different case than the exact requested key', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_FORESIGHT_PDF',
        caseId: null,
        input: { caseSnapshotId: 'snapshot-1', caseKey: 'exact-foresight-case-key' },
      }),
      foresightCase: {
        id: 'snapshot-1',
        externalKey: 'exact-foresight-case-key',
        displayName: 'Exact Foresight case',
      },
      renderForesightReport: () => ({
        caseName: 'similarly named case',
        bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1_025)]),
        mimeType: 'application/pdf',
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.savedForesightDocuments).toEqual([])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'FAILED',
      safeErrorCode: 'FORESIGHT_CASE_NOT_FOUND',
    })
  })

  it('pauses only the matching Foresight run when its SSO session expires', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
      readForesight: async () => {
        throw Object.assign(new Error('Foresight requested another login'), {
          code: 'FORESIGHT_SSO_EXPIRED',
        })
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.invalidations).toEqual([])
    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'ACTION_REQUIRED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
    expect(test.reconciledForesightRuns).toEqual(['foresight-run-1'])
    expect(test.reconciledRuns).toEqual([])
    expect(prismaMock.agentIntegrationSession.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', deploymentScope: 'scope-1', provider: 'NATIONAL_LIFE', purpose: 'CARRIER_SESSION' },
      data: { illustrationSsoReachable: false, illustrationSsoCheckedAt: expect.any(Date) },
    })
  })

  it('parks a Foresight job for login when the expiry is wrapped as a layout change', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
      readForesight: async () => {
        throw Object.assign(new Error('National Life portal layout changed'), {
          code: 'PORTAL_LAYOUT_CHANGED',
          safeDetail: {
            safeCode: 'FORESIGHT_SSO_EXPIRED',
            portalUrl: 'https://www.nationallife.com/NWI',
          },
        })
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'ACTION_REQUIRED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
    expect(prismaMock.agentIntegrationSession.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent-1', deploymentScope: 'scope-1', provider: 'NATIONAL_LIFE', purpose: 'CARRIER_SESSION' },
      data: { illustrationSsoReachable: false, illustrationSsoCheckedAt: expect.any(Date) },
    })
  })

  it('still routes a genuine layout change to manual review', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
      readForesight: async () => {
        throw Object.assign(new Error('National Life portal layout changed'), {
          code: 'PORTAL_LAYOUT_CHANGED',
          safeDetail: { safeCode: 'SELECTOR_NOT_FOUND' },
        })
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.store.transitions.at(-1)).toMatchObject({
      to: 'MANUAL_REVIEW',
    })
    expect(prismaMock.agentIntegrationSession.updateMany).not.toHaveBeenCalled()
  })

  it('disconnects, without closing or releasing, a live session reattached for a Foresight read', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'SYNC_FORESIGHT_READ',
        caseId: null,
        input: { foresightRunId: 'foresight-run-1', mode: 'INVENTORY' },
      }),
      storedSession: buildStoredSession({ liveSteelSessionId: 'steel-live-1' }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toContain('foresight:read')
    expect(test.calls).toContain('browser:disconnect')
    expect(test.calls).not.toContain('browser:close')
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
  // The PDF arrives long after the numbers did, from a different carrier
  // system, so it is filed on the row rather than returned as a job result.
  it('files the rendered PDF on the illustration it belongs to', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toContain('foresight:render')
    expect(test.calls).toContain('illustration:document')
    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  // A case the carrier cannot find is an answer, not a crash: the quote may
  // predate the tool ever seeing it. Failing would route a plain "not there"
  // through error redaction and leave the agent with a code.
  it('succeeds without a document when the carrier has no such case', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
      renderForesightReport: () => null,
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).not.toContain('illustration:document')
    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({
      to: 'SUCCEEDED',
      result: { rendered: false },
    })
  })

  // Crossing the carrier's SSO rotates the `auth0` cookie inside the live
  // browser. A job that crosses and then closes without writing the rotation
  // back leaves the next one presenting a superseded cookie, which the IdP
  // reads as replay — the session dies with nobody having logged out. The
  // standalone scripts already do this in `finally`; the worker did not, and
  // that is what killed the session ten minutes after the PDF job of
  // 2026-07-31 14:53 UTC.
  it('writes the browser context back before closing, so the SSO rotation survives', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.savedContexts).toEqual([
      { sessionId: 'integration-session-1', context: capturedContext },
    ])
    // Capture has to happen while the browser is still up.
    expect(test.calls.indexOf('context:capture')).toBeLessThan(
      test.calls.indexOf('browser:close'),
    )
  })

  // The carrier was already asked and already answered. Losing the rotation is
  // bad, but reporting a failed job over it would be worse: the agent would
  // see an error for work that succeeded, and a retry would ask again.
  it('still succeeds when the context cannot be written back', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
      saveContext: () => {
        throw new Error('steel went away')
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.calls).toContain('browser:close')
    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  // The browser the human logged in on holds the illustration tool's token in
  // page memory, so reattaching to it is the whole point: a browser rebuilt
  // from cookies has to cross the identity provider again, and crossing is what
  // burns the carrier session.
  it('reattaches to the browser the human logged in on', async () => {
    const test = createDeps({
      storedSession: buildStoredSession({ liveSteelSessionId: 'steel-live-1' }),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.reattached).toEqual(['steel-live-1'])
    expect(test.calls).not.toContain('steel:create-restored')
    expect(test.calls).toContain('browser:disconnect')
    expect(test.calls).not.toContain('browser:close')
    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

  // The held browser can be gone — Steel restarted, the session timed out, the
  // day rolled over. Falling back to the cookies is exactly what happened
  // before this existed, so the worst case is the old behaviour and never less.
  it('falls back to a fresh browser when the held one is gone', async () => {
    const test = createDeps({
      storedSession: buildStoredSession({ liveSteelSessionId: 'steel-live-1' }),
      reattachError: new Error('steel session not found'),
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.reattached).toEqual(['steel-live-1'])
    expect(test.calls).toContain('steel:create-restored')
    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({ to: 'SUCCEEDED' })
  })

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

  // A dead carrier session is not a failed request — it is a request waiting for
  // a human to connect. Failing it throws away work the agent asked for and
  // makes them ask again; parking keeps it and lets the next login carry it out.
  it('parks a request the carrier refused for want of a session', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
      renderForesightReport: () => {
        const error = new Error('carrier asked for a new login') as Error & { code?: string }
        error.code = 'FORESIGHT_SSO_EXPIRED'
        throw error
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.deps.jobStore.transitions.at(-1)).toMatchObject({
      to: 'ACTION_REQUIRED',
      safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
    })
  })

  // Everything else still fails. Parking is for the one cause a login fixes.
  it('still fails a request the carrier refused on its merits', async () => {
    const test = createDeps({
      job: buildJob({
        operation: 'GENERATE_ILLUSTRATION_PDF',
        caseId: null,
        input: { illustrationId: 'illustration-1' },
      }),
      renderForesightReport: () => {
        const error = new Error('report failed') as Error & { code?: string }
        error.code = 'FORESIGHT_REPORT_FAILED'
        throw error
      },
    })

    await runNationalLifeJob('job-1', test.deps)

    expect(test.deps.jobStore.transitions.at(-1)?.to).not.toBe('ACTION_REQUIRED')
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
