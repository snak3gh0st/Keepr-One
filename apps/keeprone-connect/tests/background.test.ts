import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('../lib/signed-client', () => ({
  SignedRequestError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  signedJsonRequest: vi.fn(),
  signedBinaryRequest: vi.fn(),
  retryIdempotentSignedRequest: vi.fn(async ({ request }: { request: () => Promise<unknown> }) => request()),
}))
vi.mock('../lib/key-store', () => ({
  clearDeviceKeys: vi.fn(),
  getOrCreateDeviceKey: vi.fn(),
  getOrCreateCredentialEncryptionKey: vi.fn(),
  readCredentialDecryptionKey: vi.fn(),
}))
vi.mock('../lib/credential-envelope', () => ({
  openSealedCredentialLease: vi.fn(),
}))

import {
  retryIdempotentSignedRequest,
  SignedRequestError,
  signedBinaryRequest,
  signedJsonRequest,
} from '../lib/signed-client'
import { sha256ForesightSnapshot } from '../lib/foresight-contract'
import { sha256ForesightTermSnapshot } from '../lib/foresight-term-contract'
import { sha256FlexLifeQuoteSnapshot } from '../lib/flexlife-quote-contract'
import { sha256IgoApplicationDossier } from '../lib/igo-contract'
import {
  getOrCreateCredentialEncryptionKey,
  getOrCreateDeviceKey,
  readCredentialDecryptionKey,
} from '../lib/key-store'
import { openSealedCredentialLease } from '../lib/credential-envelope'

const NLG = 'https://www.nationallife.com'
const NLG_AUTH0 = 'https://nlg-prod.auth0.com'
const NEW_BUSINESS_PATH = '/agent/book-of-business/new-business/all-new-business-cases'
const INFORCE_PATH = '/agent/book-of-business/inforce-book/all-clients/all-clients-agent'
const LEGACY_INFORCE_PATH = '/agent/book-of-business/inforce-book/all-clients'
const COMMISSIONS_PATH = '/agent/compensation/commissions/paid-commissions'
const COMMISSIONS_EARNING_REPORT_PATH =
  '/agent/compensation/commissions/paid-commissions/commissions-earning-report'
const COMMISSION_DETAIL_PATH =
  `${COMMISSIONS_EARNING_REPORT_PATH}/nld-commission-earning?id=aaa1`
const COMMISSION_DETAIL_PATH_2 =
  `${COMMISSIONS_EARNING_REPORT_PATH}/nld-commission-earning?id=bbb2`
const PROJECTED_COMMISSIONS_PATH = '/agent/compensation/commissions/projected-commissions'
const PAYABLE_PERSONAL_PATH =
  '/agent/compensation/commissions/projected-commissions/payable-gross-commissions/personal'
const POLICY_DETAIL_PATH =
  `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${'a'.repeat(32)}`
const FORESIGHT_PDF = new TextEncoder().encode('%PDF-1.7\n')
const FORESIGHT_PDF_HASH = createHash('sha256').update(FORESIGHT_PDF).digest('hex')
const FORESIGHT_PDF_BASE64 = Buffer.from(FORESIGHT_PDF).toString('base64')

const TWO_STAGE_PLAN = [
  { capability: 'READ_GRID', params: { gridKey: 'NEW_BUSINESS', navigatePath: NEW_BUSINESS_PATH } },
  { capability: 'READ_GRID', params: { gridKey: 'INFORCE_CLIENTS', navigatePath: INFORCE_PATH } },
]
const THREE_STAGE_PLAN = [
  TWO_STAGE_PLAN[0],
  {
    capability: 'READ_GRID',
    params: { gridKey: 'PROJECTED_COMMISSIONS', navigatePath: PROJECTED_COMMISSIONS_PATH },
  },
  TWO_STAGE_PLAN[1],
]

const LEGACY_INFORCE_STAGE_PLAN = [
  { capability: 'READ_GRID', params: { gridKey: 'NEW_BUSINESS', navigatePath: NEW_BUSINESS_PATH } },
  { capability: 'READ_GRID', params: { gridKey: 'INFORCE_CLIENTS', navigatePath: LEGACY_INFORCE_PATH } },
]
const PAID_COMMISSIONS_REDIRECT_PLAN = [
  {
    capability: 'READ_GRID',
    params: {
      gridKey: 'PAID_COMMISSIONS',
      navigatePath: COMMISSIONS_PATH,
    },
  },
]
const COMMISSION_DETAIL_PLAN = [
  {
    capability: 'READ_GRID',
    params: { gridKey: 'PAID_COMMISSIONS', navigatePath: COMMISSIONS_PATH },
  },
  {
    capability: 'READ_GRID',
    params: {
      gridKey: 'COMMISSIONS_EARNING_REPORT',
      navigatePath: COMMISSIONS_EARNING_REPORT_PATH,
      mode: 'COMMISSION_DETAILS',
    },
  },
]

type Listener = (...args: unknown[]) => unknown

const storage: Record<string, unknown> = {}
const listeners: Record<string, Listener[]> = {}
const alarms = new Map<string, Record<string, unknown>>()

function register(name: string) {
  return {
    addListener: (fn: Listener) => {
      ;(listeners[name] ??= []).push(fn)
    },
  }
}

async function defaultTabMessageResponse(tabId: number, message: unknown): Promise<unknown> {
  void tabId
  const value = message as {
    type?: string
    gridKey?: string
    sourceKey?: string
    token?: string
    correlationId?: string
    inputHash?: string
    payloadHash?: string
    snapshot?: { carrierCaseName?: string }
  }
  if (value.type === 'CAPTURE_PAGE') {
    return {
      ok: true,
      type: 'PAGE_CAPTURED',
      sourceKey: value.sourceKey,
      token: value.token,
      correlationId: value.correlationId,
      records: [{ RecordType: 'PAGE_META', Title: 'Agent dashboard' }],
    }
  }
  if (value.type === 'PROBE_AUTH') {
    return {
      ok: true,
      type: 'AUTH_PROBED',
      token: value.token,
      correlationId: value.correlationId,
      authenticated: true,
    }
  }
  if (value.type === 'OPEN_IGO_EAPP_FROM_TOOLS') {
    return {
      ok: true,
      type: 'IGO_EAPP_OPENED_FROM_TOOLS',
      token: value.token,
      correlationId: value.correlationId,
    }
  }
  if (value.type === 'CAPTURE_POLICY_DETAIL') {
    return {
      ok: true,
      type: 'POLICY_DETAIL_CAPTURED',
      token: value.token,
      correlationId: value.correlationId,
      detail: {
        navigatePath: POLICY_DETAIL_PATH,
        expectedPolicyNumber: 'LS1473219',
        visiblePolicyNumber: 'LS1473219',
        observedAt: '2026-08-26T17:00:00.000Z',
        fields: [
          { section: 'COVERAGE', label: 'Total Face Amount', value: '$100,000.00' },
          { section: 'PAYMENTS', label: 'Anticipated Annual Premium', value: '$5,100.00' },
        ],
      },
    }
  }
  if (value.type === 'EXECUTE_FORESIGHT_ILLUSTRATION') {
    return {
      ok: true,
      type: 'FORESIGHT_ILLUSTRATION_SAVED',
      token: value.token,
      correlationId: value.correlationId,
      receipt: {
        inputHash: value.inputHash,
        caseFingerprint: `case_${'b'.repeat(64)}`,
        carrierCaseName: value.snapshot?.carrierCaseName,
        productCode: '956',
        release: '5.3.65.31',
        reportCode: 'NAIC_ILLUSTRATION',
        documentSha256: FORESIGHT_PDF_HASH,
        documentBytes: FORESIGHT_PDF.byteLength,
        saved: true,
      },
      document: { contentType: 'application/pdf', pdfBase64: FORESIGHT_PDF_BASE64 },
    }
  }
  if (value.type === 'EXECUTE_FLEXLIFE_QUOTE') {
    return {
      ok: true,
      type: 'FLEXLIFE_QUOTE_RECEIVED',
      token: value.token,
      correlationId: value.correlationId,
      inputHash: value.inputHash,
      response: {
        Success: true,
        FaceAmount: '$250,000.00',
        AnnualPremium: '$4,200.00',
        MonthlyPremium: '$350.00',
        LapseYear: 0,
      },
    }
  }
  if (value.type === 'EXECUTE_IGO_APPLICATION_DRAFT') {
    const applicationSnapshot = value.snapshot as unknown as {
      applicationId: string
      dossier: {
        insured: { firstName: string; lastName: string; birthDate: string }
        coverage: {
          family: 'TERM' | 'IUL'; carrierProduct: string; termDuration?: string; issueState: string
        }
      }
    }
    return {
      ok: true,
      type: 'IGO_APPLICATION_DRAFT_SAVED',
      token: value.token,
      correlationId: value.correlationId,
      receipt: {
        schemaVersion: 2,
        applicationId: applicationSnapshot.applicationId,
        payloadHash: value.payloadHash,
        draftReadBackHash: 'd'.repeat(64),
        externalApplicationId: 'igo-case-1',
        carrierStatus: 'Started',
        progress: 'CASE_CREATED',
        confirmedValues: {
          insuredName: `${applicationSnapshot.dossier.insured.firstName} ${applicationSnapshot.dossier.insured.lastName}`,
          birthDate: applicationSnapshot.dossier.insured.birthDate,
          family: applicationSnapshot.dossier.coverage.family,
          carrierProduct: applicationSnapshot.dossier.coverage.carrierProduct,
          termDuration: applicationSnapshot.dossier.coverage.family === 'TERM'
            ? applicationSnapshot.dossier.coverage.termDuration
            : null,
          issueState: applicationSnapshot.dossier.coverage.issueState,
        },
        changes: [],
        missingQuestions: [{
          section: 'Pre-Qualification',
          label: 'Do any of these conditions apply?',
          allowedValues: ['Yes', 'No'],
        }],
      },
    }
  }
  if (value.type === 'BEGIN_GRID' || value.type === 'ABORT_GRID') {
    return {
      ok: true,
      type: value.type === 'BEGIN_GRID' ? 'BEGIN_GRID_ACK' : 'ABORT_GRID_ACK',
      gridKey: value.gridKey,
      token: value.token,
      correlationId: value.correlationId,
    }
  }
  return { ok: true }
}

const tabs = {
  query: vi.fn(async () => [] as unknown[]),
  update: vi.fn(async () => undefined),
  reload: vi.fn(async () => undefined),
  create: vi.fn(async () => ({ id: 4, active: false, url: undefined })),
  remove: vi.fn(async () => undefined),
  // Tipado com os dois argumentos reais para que um teste possa afirmar sobre a
  // mensagem enviada, e não só sobre ter havido envio.
  sendMessage: vi.fn(defaultTabMessageResponse),
  onUpdated: register('tabs.onUpdated'),
  onRemoved: register('tabs.onRemoved'),
}

const chromeStub = {
  storage: {
    local: {
      get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
      set: async (value: Record<string, unknown>) => {
        Object.assign(storage, value)
      },
      remove: async (key: string) => {
        delete storage[key]
      },
    },
  },
  runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    getManifest: () => ({ version: '0.1.0' }),
    requestUpdateCheck: vi.fn(async () => ({ status: 'no_update' })),
    reload: vi.fn(),
    onInstalled: register('runtime.onInstalled'),
    onMessage: register('runtime.onMessage'),
    onMessageExternal: register('runtime.onMessageExternal'),
  },
  alarms: {
    create: vi.fn((name: string, options: Record<string, unknown>) => {
      alarms.set(name, { name, ...options })
    }),
    get: vi.fn(async (name: string) => alarms.get(name)),
    clear: vi.fn(async (name: string) => alarms.delete(name)),
    onAlarm: register('alarms.onAlarm'),
  },
  tabs,
}

/// Boots the background entrypoint the way the browser does: fresh module state (a
/// service worker that was evicted keeps nothing but chrome.storage), listeners
/// registered, `resumePending` already fired.
async function bootBackground() {
  vi.resetModules()
  for (const key of Object.keys(listeners)) delete listeners[key]
  const entry = await import('../entrypoints/background')
  await (entry.default as unknown as () => unknown)()
  // Let resumePending's promise chain settle before the test inspects anything.
  await flush()
}

async function flush() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

function emit(name: string, ...args: unknown[]) {
  for (const listener of listeners[name] ?? []) listener(...args)
}

function readSync() {
  return storage.sync as Record<string, unknown>
}

const EXTERNAL_SENDER = {
  origin: 'http://localhost:3000',
  url: 'http://localhost:3000/agent/integrations/national-life',
}

function beginGridMessage() {
  const call = tabs.sendMessage.mock.calls.at(-1) as unknown as [number, Record<string, unknown>]
  return call?.[1]
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key]
  alarms.clear()
  vi.clearAllMocks()
  // The worker opportunistically refreshes its remote config in the background.
  // Keep this executor suite independent from whatever happens to be listening on
  // localhost:3000: a delayed PAUSED response can otherwise land between two
  // START_NATIONAL_LIFE_SYNC messages and make a lock test fail for the wrong
  // reason. Remote-config fetching and pause parsing have their own focused tests.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('REMOTE_CONFIG_UNAVAILABLE')
  }))
  tabs.sendMessage.mockImplementation(defaultTabMessageResponse)
  vi.mocked(signedJsonRequest).mockResolvedValue({})
  vi.mocked(signedBinaryRequest).mockResolvedValue({
    documentSha256: FORESIGHT_PDF_HASH,
    documentBytes: FORESIGHT_PDF.byteLength,
  })
  tabs.query.mockResolvedValue([])
  storage.device = {
    deviceId: 'device-1', baseUrl: 'http://localhost:3000', status: 'READY',
    credentialEncryptionKeyRegistered: true,
  }
  vi.mocked(getOrCreateDeviceKey).mockResolvedValue({ kty: 'EC', crv: 'P-256' })
  vi.mocked(getOrCreateCredentialEncryptionKey).mockResolvedValue({
    kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    e: 'AQAB', n: 'public-modulus',
  })
  vi.mocked(readCredentialDecryptionKey).mockResolvedValue({
    type: 'private', extractable: false, usages: ['decrypt'],
  } as CryptoKey)
  vi.mocked(openSealedCredentialLease).mockResolvedValue({
    formatVersion: 1,
    username: 'synthetic-carrier-user',
    password: 'synthetic-carrier-password',
  })
  vi.stubGlobal('chrome', chromeStub)
  vi.stubGlobal('defineBackground', (main: unknown) => main)
  // The extension's own vitest config substitutes this at build time; the repo-root
  // config does not, and without it every allowed-origin check fails.
  vi.stubGlobal('__KEEPR_ORIGIN__', 'http://localhost:3000')
})

describe('credential encryption key enrollment', () => {
  it('includes the public encryption key when pairing and never sends private fields', async () => {
    storage.device = { status: 'UNPAIRED' }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ deviceId: 'device-paired' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    await bootBackground()
    const sendResponse = vi.fn()

    emit(
      'runtime.onMessageExternal',
      {
        type: 'PAIR_CONNECTOR',
        code: 'NL-secret-pairing-code',
        label: 'Este computador',
        baseUrl: 'http://localhost:3000',
      },
      EXTERNAL_SENDER,
      sendResponse,
    )
    await flush()

    const pairingCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/pairings/exchange'))
    const body = JSON.parse(String(pairingCall?.[1]?.body))
    expect(body.encryptionPublicKeyJwk).toMatchObject({
      kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
    })
    expect(JSON.stringify(body.encryptionPublicKeyJwk)).not.toMatch(
      /"d"|"p"|"q"|"dp"|"dq"|"qi"/,
    )
    expect(storage.device).toMatchObject({
      deviceId: 'device-paired', credentialEncryptionKeyRegistered: true,
    })
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, deviceId: 'device-paired' })
  })

  it('registers once after upgrading an already paired device', async () => {
    storage.device = {
      deviceId: 'device-1', baseUrl: 'http://localhost:3000', status: 'READY',
    }

    await bootBackground()
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:3000',
      deviceId: 'device-1',
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/devices/encryption-key',
      body: {
        schemaVersion: 1,
        publicKeyJwk: expect.objectContaining({ kty: 'RSA', alg: 'RSA-OAEP-256' }),
      },
    })
    expect(storage.device).toMatchObject({ credentialEncryptionKeyRegistered: true })

    vi.mocked(signedJsonRequest).mockClear()
    await bootBackground()
    await flush()
    expect(signedJsonRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/devices/encryption-key',
    }))
  })
})

describe('automatic carrier login recovery', () => {
  const authUrl = `${NLG_AUTH0}/login?state=pending`
  const sealed = {
    schemaVersion: 1,
    leaseId: 'lease_1',
    expiresAt: '2026-09-01T21:01:00.000Z',
    operation: { kind: 'SYNC_RUN', id: 'run-1', authEpoch: 3 },
    keyAlgorithm: 'RSA-OAEP-256',
    contentAlgorithm: 'AES-256-GCM',
    wrappedKey: 'sealed-only-in-memory',
    iv: 'sealed-only-in-memory',
    ciphertext: 'sealed-only-in-memory',
  }

  function authResponder(classification: 'LOGIN' | 'MFA' | 'REJECTED' | 'UNKNOWN') {
    return async (tabId: number, message: unknown) => {
      const value = message as { type?: string }
      if (value.type === 'CLASSIFY_CARRIER_AUTH_PAGE') {
        return { ok: true, code: classification }
      }
      if (value.type === 'SUBMIT_CARRIER_CREDENTIAL') {
        return { ok: true, code: 'SUBMITTED' }
      }
      return defaultTabMessageResponse(tabId, message)
    }
  }

  function brokerResponder() {
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/auth-state')) return { authEpoch: 3 } as never
      if (request.pathname.endsWith('/credential-leases')) return sealed as never
      return {} as never
    })
  }

  it('obtains one lease, opens it locally and submits the exact login once', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    brokerResponder()
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    const leaseCalls = vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))
    expect(leaseCalls).toHaveLength(1)
    expect(openSealedCredentialLease).toHaveBeenCalledWith(sealed, expect.anything(), {
      operation: { kind: 'SYNC_RUN', id: 'run-1', authEpoch: 3 },
    })
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: 'SUBMIT_CARRIER_CREDENTIAL',
      credential: {
        formatVersion: 1,
        username: 'synthetic-carrier-user',
        password: 'synthetic-carrier-password',
      },
    })
    expect(storage.sync).toMatchObject({
      status: 'AUTH_REQUIRED',
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 3, leaseId: 'lease_1',
      },
    })
    expect(JSON.stringify(storage)).not.toMatch(
      /synthetic-carrier-user|synthetic-carrier-password|wrappedKey|ciphertext|"iv"/,
    )
  })

  it('retries the existing Auth0 tab and submits the stored credential immediately', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 1,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      authRequiredAt: '2026-09-01T20:00:00.000Z',
      errorCode: 'CREDENTIAL_BROKER_UNAVAILABLE',
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 0,
        attemptedAt: '2026-09-01T20:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/runs')) {
        return {
          runId: 'run-1', schemaVersion: 3, stages: TWO_STAGE_PLAN,
          duplicate: true, completedStages: 1, nextStageIndex: 1,
        } as never
      }
      if (request.pathname.endsWith('/auth-state')) return { authEpoch: 3 } as never
      if (request.pathname.endsWith('/credential-leases')) return sealed as never
      return {} as never
    })
    await bootBackground()
    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(0)

    const sendResponse = vi.fn()
    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, sendResponse)
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(1)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
    }))
    expect(readSync()).toMatchObject({
      runId: 'run-1', stageIndex: 1, status: 'AUTH_REQUIRED',
      authRenewalPending: true,
      credentialAttempt: { authEpoch: 3, leaseId: 'lease_1' },
    })
    const authStateCalls = vi.mocked(signedJsonRequest).mock.calls
      .map(([request]) => request)
      .filter((request) => request.pathname.endsWith('/auth-state'))
    expect(authStateCalls.map((request) => request.body)).toEqual([
      { state: 'RETRY_REQUIRED' },
      { state: 'REQUIRED' },
    ])
  })

  it('reloads an already-open Auth0 page once, then leases when the content script is ready', async () => {
    await bootBackground()
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'NAVIGATING',
    }
    let classifications = 0
    tabs.sendMessage.mockImplementation(async (tabId: number, message: unknown) => {
      const value = message as { type?: string }
      if (value.type === 'CLASSIFY_CARRIER_AUTH_PAGE') {
        classifications += 1
        if (classifications === 1) throw new Error('auth content script is still loading')
        return { ok: true, code: 'LOGIN' }
      }
      if (value.type === 'SUBMIT_CARRIER_CREDENTIAL') return { ok: true, code: 'SUBMITTED' }
      return defaultTabMessageResponse(tabId, message)
    })
    brokerResponder()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    expect(tabs.reload).toHaveBeenCalledTimes(1)
    expect(tabs.reload).toHaveBeenCalledWith(7)
    expect(storage.sync).toMatchObject({
      status: 'AUTH_REQUIRED',
      credentialPageReloadedAt: expect.any(String),
    })
    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(0)

    const readyResponse = vi.fn()
    emit(
      'runtime.onMessage',
      { type: 'CARRIER_AUTH_PAGE_READY' },
      { id: chromeStub.runtime.id, tab: { id: 7 }, url: authUrl },
      readyResponse,
    )
    await flush()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(1)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
    }))
    expect(readyResponse).toHaveBeenCalledWith({ ok: true })
  })

  it('never reloads the same unsupported Auth0 episode twice', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      credentialPageReloadedAt: '2026-09-01T21:00:00.000Z',
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('UNKNOWN'))

    await bootBackground()
    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    expect(tabs.reload).not.toHaveBeenCalled()
    expect(storage.sync).toMatchObject({
      status: 'AUTH_REQUIRED',
      credentialPageReloadedAt: '2026-09-01T21:00:00.000Z',
      errorCode: 'CREDENTIAL_PAGE_UNSUPPORTED',
    })
    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(0)
  })

  it('recovers a stale pre-lease marker after service-worker eviction', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      errorCode: 'CREDENTIAL_AUTO_LOGIN_IN_PROGRESS',
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 0,
        attemptedAt: '2026-09-01T20:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    brokerResponder()

    await bootBackground()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(1)
    expect(tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
    }))
    expect(storage.sync).toMatchObject({
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 3, leaseId: 'lease_1',
      },
    })
  })

  it('does not duplicate a fresh pre-lease request that may still be in flight', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      errorCode: 'CREDENTIAL_AUTO_LOGIN_IN_PROGRESS',
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 0,
        attemptedAt: new Date().toISOString(),
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    brokerResponder()

    await bootBackground()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(0)
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(7, expect.objectContaining({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
    }))
  })

  it('retries a command login once when Auth0 reports readiness, even if it signals twice', async () => {
    storage.command = {
      commandId: 'cmd-1', runId: 'command-run-1', carrierTabId: 7,
      status: 'AUTH_REQUIRED', nextEventSequence: 3,
    }
    const commandSealed = {
      ...sealed,
      operation: { kind: 'CONNECTOR_COMMAND' as const, id: 'cmd-1', authEpoch: 3 },
    }
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/credential-leases')) return commandSealed as never
      return {} as never
    })
    await bootBackground()

    for (const respond of [vi.fn(), vi.fn()]) {
      emit(
        'runtime.onMessage',
        { type: 'CARRIER_AUTH_PAGE_READY' },
        { id: chromeStub.runtime.id, tab: { id: 7 }, url: authUrl },
        respond,
      )
    }
    await flush()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(1)
    expect(tabs.sendMessage.mock.calls.filter(([, message]) =>
      (message as { type?: string }).type === 'SUBMIT_CARRIER_CREDENTIAL')).toHaveLength(1)
  })

  it('closes an issued lease as unknown when the exact login submit cannot be completed', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(async (tabId: number, message: unknown) => {
      const value = message as { type?: string }
      if (value.type === 'CLASSIFY_CARRIER_AUTH_PAGE') {
        return { ok: true, code: 'LOGIN' }
      }
      if (value.type === 'SUBMIT_CARRIER_CREDENTIAL') {
        throw new Error('content script unavailable')
      }
      return defaultTabMessageResponse(tabId, message)
    })
    brokerResponder()
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
      body: { schemaVersion: 1, outcome: 'UNKNOWN_PAGE' },
    }))
    expect(storage.sync).toMatchObject({
      status: 'AUTH_REQUIRED',
      errorCode: 'CREDENTIAL_PAGE_UNSUPPORTED',
      credentialAttempt: { leaseId: 'lease_1' },
    })
  })

  it('survives service-worker eviction without a second lease or submit', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    brokerResponder()

    await bootBackground()
    await bootBackground()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(0)
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'SUBMIT_CARRIER_CREDENTIAL' }),
    )
  })

  it('does not retry an ambiguous lease response', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/credential-leases')) throw new TypeError('Failed to fetch')
      return {} as never
    })
    await bootBackground()
    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()
    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    expect(vi.mocked(signedJsonRequest).mock.calls.filter(([request]) =>
      request.pathname.endsWith('/credential-leases'))).toHaveLength(1)
    expect(storage.sync).toMatchObject({
      errorCode: 'CREDENTIAL_BROKER_UNAVAILABLE',
      credentialAttempt: { operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 0 },
    })
  })

  it('reports authenticated proof, clears the attempt and resumes the same sync', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    brokerResponder()
    await bootBackground()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
      body: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    }))
    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-1/auth-state',
      body: { state: 'RESTORED' },
    }))
    expect(storage.sync).toMatchObject({ status: 'EXTRACTING', authRenewalPending: false })
    expect((storage.sync as Record<string, unknown>).credentialAttempt).toBeUndefined()
  })

  it('settles a command credential lease after the command has already started', async () => {
    storage.command = {
      commandId: 'cmd-1', runId: 'command-run-1', carrierTabId: 17,
      nextEventSequence: 4, status: 'RUNNING', phase: 'OPENING_FORESIGHT',
      errorCode: 'CREDENTIAL_AUTO_LOGIN_IN_PROGRESS',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: 'cmd-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    await bootBackground()
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return undefined as never
      return {} as never
    })
    const commandWrites: Array<Record<string, unknown>> = []
    const set = chromeStub.storage.local.set
    chromeStub.storage.local.set = async (value) => {
      if (value.command && typeof value.command === 'object') {
        commandWrites.push(value.command as Record<string, unknown>)
      }
      await set(value)
    }

    emit('tabs.onUpdated', 17, { status: 'complete' }, {
      id: 17, active: true, url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    await flush()
    chromeStub.storage.local.set = set

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
      body: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    }))
    const settled = commandWrites.find((write) => write.status === 'RUNNING')
    expect(settled).toMatchObject({
      commandId: 'cmd-1', status: 'RUNNING', phase: 'OPENING_FORESIGHT',
    })
    expect(settled).not.toHaveProperty('credentialAttempt')
    expect(settled).not.toHaveProperty('errorCode')
  })

  it('settles a command credential lease after Auth0 lands directly in authenticated Foresight', async () => {
    storage.command = {
      commandId: 'cmd-1', runId: 'command-run-1', carrierTabId: 17,
      nextEventSequence: 4, status: 'RUNNING', phase: 'OPENING_FORESIGHT',
      errorCode: 'CREDENTIAL_AUTO_LOGIN_IN_PROGRESS',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: 'cmd-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    await bootBackground()
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return undefined as never
      return {} as never
    })

    emit('tabs.onUpdated', 17, { status: 'complete' }, {
      id: 17,
      active: true,
      url: `${NLG}/NWI/Main/Layout.aspx?SessionTokenId=${'a'.repeat(32)}`,
    })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
      body: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    }))
    expect(storage.command).not.toHaveProperty('credentialAttempt')
    expect(storage.command).not.toHaveProperty('errorCode')
  })

  it('does not treat a tokenless Foresight shell as authenticated login proof', async () => {
    storage.command = {
      commandId: 'cmd-1', runId: 'command-run-1', carrierTabId: 17,
      nextEventSequence: 4, status: 'RUNNING', phase: 'OPENING_FORESIGHT',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: 'cmd-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    await bootBackground()
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return undefined as never
      return {} as never
    })

    emit('tabs.onUpdated', 17, { status: 'complete' }, {
      id: 17, active: true, url: `${NLG}/NWI/Main/Layout.aspx`,
    })
    await flush()

    expect(signedJsonRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
    }))
  })

  it('settles login when a command worker wakes already inside authenticated Foresight', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd-foresight-wake',
      runId: 'run-foresight-wake',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'ill-wake' },
      params: { illustrationId: 'ill-wake', inputHash: 'a'.repeat(64) },
      idempotencyKey: 'illustration:ill-wake',
      issuedAt: '2026-09-01T21:00:00.000Z',
      expiresAt: '2026-09-01T22:00:00.000Z',
      requiresConfirmation: true,
    }
    storage.command = {
      commandId: command.commandId, runId: command.runId, carrierTabId: 17,
      nextEventSequence: 3, status: 'AUTH_REQUIRED', phase: 'OPENING_FORESIGHT',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: command.commandId, authEpoch: 2,
        leaseId: 'lease-wake', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{
      id: 17,
      active: false,
      url: `${NLG}/NWI/Main/Layout.aspx?SessionTokenId=${'b'.repeat(32)}`,
    }])
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'AUTH_REQUIRED', nextEventSequence: 3, lastEventType: 'AUTH_REQUIRED',
      } as never
      if (request.pathname.endsWith('/input')) return {} as never
      return {} as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease-wake/result',
      body: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    }))
  })

  it('settles login when an iGO worker wakes on the authenticated National Life tools page', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd-igo-wake',
      runId: 'run-igo-wake',
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'app-wake' },
      params: { applicationId: 'app-wake', payloadHash: 'c'.repeat(64) },
      idempotencyKey: 'igo:app-wake',
      issuedAt: '2026-09-01T21:00:00.000Z',
      expiresAt: '2026-09-01T22:00:00.000Z',
      requiresConfirmation: true,
    }
    storage.command = {
      commandId: command.commandId, runId: command.runId, carrierTabId: 17,
      nextEventSequence: 3, status: 'AUTH_REQUIRED', phase: 'OPENING_IGO',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: command.commandId, authEpoch: 2,
        leaseId: 'lease-igo-wake', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{
      id: 17,
      active: false,
      url: `${NLG}/agent/tools/business-tools/national-life-tools`,
    }])
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'AUTH_REQUIRED', nextEventSequence: 3, lastEventType: 'AUTH_REQUIRED',
      } as never
      return {} as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease-igo-wake/result',
      body: { schemaVersion: 1, outcome: 'AUTHENTICATED' },
    }))
  })

  it.each([
    ['MFA', 'MFA_REQUIRED'],
    ['REJECTED', 'CREDENTIAL_REJECTED'],
  ] as const)('reports %s once and waits for manual recovery', async (classification, errorCode) => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0,
      status: 'AUTH_REQUIRED', authRenewalPending: true,
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-1', authEpoch: 3,
        leaseId: 'lease_1', attemptedAt: '2026-09-01T21:00:00.000Z',
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder(classification))
    brokerResponder()
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { id: 7, active: true, url: authUrl })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases/lease_1/result',
      body: { schemaVersion: 1, outcome: classification === 'MFA' ? 'MFA_REQUIRED' : 'REJECTED' },
    }))
    expect(storage.sync).toMatchObject({ status: 'AUTH_REQUIRED', errorCode })
    expect(tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'SUBMIT_CARRIER_CREDENTIAL' }),
    )
  })

  it('uses the same one-shot login recovery for illustration and iGO commands', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'command_auth_1',
      runId: 'command_run_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      params: { policyNumber: 'LS1473219', navigatePath: POLICY_DETAIL_PATH },
      idempotencyKey: 'command_auth_1',
      issuedAt: '2026-09-01T20:00:00.000Z',
      expiresAt: '2026-09-01T22:00:00.000Z',
      requiresConfirmation: false,
    }
    const commandSealed = {
      ...sealed,
      operation: { kind: 'CONNECTOR_COMMAND', id: command.commandId, authEpoch: 5 },
    }
    storage.sync = { status: 'IDLE' }
    storage.command = {
      commandId: command.commandId,
      runId: command.runId,
      carrierTabId: 17,
      nextEventSequence: 2,
      status: 'AUTH_REQUIRED',
    }
    tabs.query.mockResolvedValue([{ id: 17, active: true, url: authUrl }])
    tabs.sendMessage.mockImplementation(authResponder('LOGIN'))
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) {
        return {
          command, state: 'AUTH_REQUIRED', nextEventSequence: 2, lastEventType: 'AUTH_REQUIRED',
        } as never
      }
      if (request.pathname.endsWith('/credential-leases')) return commandSealed as never
      return {} as never
    })
    await bootBackground()

    emit('tabs.onUpdated', 17, { status: 'complete' }, { id: 17, active: true, url: authUrl })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/credential-leases',
      body: expect.objectContaining({
        operation: { kind: 'CONNECTOR_COMMAND', id: command.commandId },
      }),
    }))
    expect(tabs.sendMessage).toHaveBeenCalledWith(17, expect.objectContaining({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
    }))
    expect(storage.command).toMatchObject({
      status: 'AUTH_REQUIRED',
      credentialAttempt: {
        operationKind: 'CONNECTOR_COMMAND', operationId: command.commandId,
        authEpoch: 5, leaseId: 'lease_1',
      },
    })
  })
})

describe('empurrão de atualização no caminho real', () => {
  it('empurra quando o servidor diz que esta versão está abaixo do piso', async () => {
    // O caso que quase escapou: `failSync` roda **dentro** de `withSyncLock`, então
    // um `isBusy` que consultasse o lock devolveria BUSY sempre e o empurrão nunca
    // aconteceria — exatamente no gatilho para o qual ele foi construído.
    vi.mocked(signedJsonRequest).mockRejectedValue(
      Object.assign(new Error('CLIENT_TOO_OLD'), { code: 'CLIENT_TOO_OLD' }),
    )
    await bootBackground()

    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CLIENT_TOO_OLD' })
    expect(chromeStub.runtime.requestUpdateCheck).toHaveBeenCalled()
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    // E a trava ficou gravada antes do reload, não depois.
    expect(storage.updateNudge).toMatchObject({ version: '0.1.0', reloadCount: 1 })
  })

  it('a trava persistida sobrevive à morte do worker e barra o segundo reload', async () => {
    // Esta é a asserção que um `chrome.runtime.reload()` solto no lugar do
    // empurrão **não** satisfaz: ele recarregaria de novo. Reiniciar o worker é o
    // caso real — reload() mata o worker, então a segunda decisão sempre acontece
    // num módulo recém-carregado, com os globais zerados.
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))
    await bootBackground()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)

    // Worker morre e volta. Só o chrome.storage.local sobrevive.
    await bootBackground()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    expect(storage.updateNudge).toMatchObject({ reloadCount: 1 })
  })

  it('empurra quando o 426 chega no PUT de um lote, não no início do run', async () => {
    // O caminho dominante de verdade: subir o piso contra runs já em voo é o que
    // "subir o piso" significa operacionalmente, e aí a recusa chega no upload de
    // um lote. `processBridgeMessage` chama `failSync` com a própria entrada dele
    // ainda pendente na fila da aba — contar essa entrada devolvia BUSY sempre,
    // que é o mesmo erro do `syncStartLock`, um braço adiante.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CLIENT_TOO_OLD' })
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    expect(storage.updateNudge).toMatchObject({ version: '0.1.0', reloadCount: 1 })
  })

  it('manda o extrator parar quando o servidor recusa o lote por pausa', async () => {
    // Recusar o upload já impedia o dado de entrar. O que não parava era a
    // extração: o laço na página fala com o portal, não com o Keepr One, e
    // seguia paginando a National Life até o estágio acabar sozinho.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CONNECTOR_PAUSED'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CONNECTOR_PAUSED' })
    // A ordem tem de falar da extração que está rodando: com token de outra, a
    // página a ignoraria e continuaria dirigindo o portal.
    expect(tabs.sendMessage).toHaveBeenLastCalledWith(7, {
      type: 'ABORT_GRID',
      gridKey: 'NEW_BUSINESS',
      token: begin.token,
      correlationId: begin.correlationId,
    })
  })

  it('manda parar antes de recarregar a extensão no 426', async () => {
    // Ordem, não coincidência: `failSync` num CLIENT_TOO_OLD pode chamar
    // `chrome.runtime.reload()`, que mata este worker. Uma ordem de parar
    // emitida depois disso nunca sairia, e o portal seguiria sendo dirigido
    // exatamente no caso em que a extensão inteira está sendo trocada.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()

    const order: string[] = []
    tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
      order.push((message as { type: string }).type)
      return { ok: true }
    })
    chromeStub.runtime.reload.mockImplementation(() => {
      order.push('reload')
    })
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(order).toEqual(['ABORT_GRID', 'reload'])
  })

  it('não empurra numa falha que atualizar não resolve', async () => {
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('PORTAL_REQUEST_FAILED'))
    await bootBackground()

    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(chromeStub.runtime.reload).not.toHaveBeenCalled()
  })
})

describe('background plan executor', () => {
  it('returns to the existing Keepr One tab after Store install without opening a duplicate', async () => {
    const keeprUrl = 'http://localhost:3000/agent/integrations/national-life'
    const storeUrl =
      'https://chromewebstore.google.com/detail/keeproneconnect/abcdefghijklmnopabcdefghijklmnop'
    tabs.query.mockResolvedValue([
      { id: 21, active: false, url: keeprUrl, lastAccessed: 10 },
      { id: 22, active: true, url: storeUrl, lastAccessed: 20 },
    ])
    await bootBackground()

    emit('runtime.onInstalled', { reason: 'install' })
    await flush()

    expect(tabs.update).toHaveBeenCalledWith(21, { active: true })
    expect(tabs.remove).toHaveBeenCalledWith(22)
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('opens Keepr One from the popup when this browser is not paired', async () => {
    storage.device = { status: 'UNPAIRED' }
    const keeprUrl = 'http://localhost:3000/agent/integrations/national-life'
    tabs.query.mockResolvedValue([{ id: 21, active: false, url: keeprUrl }])
    await bootBackground()
    const sendResponse = vi.fn()

    emit('runtime.onMessage', { type: 'OPEN_KEEPR' }, {}, sendResponse)

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }))
    expect(tabs.update).toHaveBeenCalledWith(21, { active: true })
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('does not swallow an on-demand command while a background poll is in flight', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_policy_during_poll',
      runId: 'run_policy_during_poll',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      params: { policyNumber: 'LS1473219', navigatePath: POLICY_DETAIL_PATH },
      idempotencyKey: 'policy_1:detail:during-poll',
      issuedAt: '2026-08-27T16:00:00.000Z',
      expiresAt: '2026-08-27T16:30:00.000Z',
      requiresConfirmation: false,
    }
    let releaseBackgroundPoll!: (value: unknown) => void
    const backgroundPoll = new Promise((resolve) => { releaseBackgroundPoll = resolve })
    let pollCalls = 0
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (!request.pathname.endsWith('/commands/next')) return undefined as never
      pollCalls += 1
      if (pollCalls === 1) return await backgroundPoll as never
      expect(request.body).toEqual({ commandId: command.commandId })
      return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_COMMAND', commandId: command.commandId },
      EXTERNAL_SENDER,
      vi.fn(),
    )
    await flush()
    releaseBackgroundPoll(undefined)

    await vi.waitFor(() => expect(pollCalls).toBe(2))
    expect(tabs.create).toHaveBeenCalledWith({ active: false, url: `${NLG}${POLICY_DETAIL_PATH}` })
  })

  it('executes a sealed FlexLife quote in the agent portal instead of Steel', async () => {
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_quote_1',
      request: {
        IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
        IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
        Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
        Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
      },
    } as const
    const inputHash = await sha256FlexLifeQuoteSnapshot(snapshot)
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_quote_1',
      runId: 'run_quote_1',
      capability: 'FLEXLIFE_QUOTE',
      target: { kind: 'ILLUSTRATION', id: snapshot.illustrationId },
      params: { illustrationId: snapshot.illustrationId, inputHash },
      idempotencyKey: `quote:${snapshot.illustrationId}:${inputHash}`,
      issuedAt: '2026-08-26T17:00:00.000Z',
      expiresAt: '2026-08-26T18:00:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
      if (request.pathname.endsWith('/commands/cmd_quote_1/input')) {
        return { inputHash, snapshot } as never
      }
      return undefined as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}/agent/tools/business-tools/illustrations`,
    })

    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4, active: false, url: `${NLG}/agent/tools/business-tools/illustrations`,
    })
    await flush()

    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ type: 'EXECUTE_FLEXLIFE_QUOTE', inputHash, snapshot }),
    ))
    const events = vi.mocked(signedJsonRequest).mock.calls
      .map(([request]) => request)
      .filter((request) => request.pathname.endsWith('/commands/cmd_quote_1/events'))
      .map((request) => request.body as { type: string; payload?: unknown })
    expect(events.map((event) => event.type)).toEqual([
      'COMMAND_STARTED', 'DATA_BATCH', 'COMMAND_COMPLETED',
    ])
    expect(events[1]?.payload).toEqual({
      flexLifeQuote: {
        inputHash,
        response: {
          Success: true,
          FaceAmount: '$250,000.00',
          AnnualPremium: '$4,200.00',
          MonthlyPremium: '$350.00',
          LapseYear: 0,
        },
      },
    })
  })

  it('opens iGO and writes only the sealed Application draft, never a submission', async () => {
    const snapshot = {
      schemaVersion: 2,
      applicationId: 'application_1',
      payloadHash: '0'.repeat(64),
      dossier: {
        version: 2,
        insured: { firstName: 'Alex', lastName: 'Test', birthDate: '1990-01-01', sexAtBirth: 'MALE', email: 'alex@example.com', phone: '+13055550123' },
        address: { line1: '100 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
        owner: { sameAsInsured: true, relationship: 'SELF' },
        beneficiaries: [{ fullName: 'Taylor Test', relationship: 'SPOUSE', sharePercent: 100 }],
        coverage: { family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL', applicationType: 'FULL', illustrationId: 'illustration_1', illustrationInputHash: 'b'.repeat(64), faceAmount: 500_000, premiumMode: 'MONTHLY', plannedPremium: 300 },
        agent: { carrierNumber: 'AGENT123' },
        existingCoverage: { hasExisting: false, replacementExpected: false },
        documents: [{ documentId: 'doc_1', type: 'IDENTITY', contentHash: 'c'.repeat(64) }],
        consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
      },
    } as const
    const payloadHash = await sha256IgoApplicationDossier({ ...snapshot, payloadHash: 'a'.repeat(64) })
    const sealedSnapshot = { ...snapshot, payloadHash }
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_application_1',
      runId: 'run_application_1',
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: snapshot.applicationId },
      params: { applicationId: snapshot.applicationId, payloadHash },
      idempotencyKey: `application:${snapshot.applicationId}:${payloadHash}`,
      issuedAt: '2026-08-31T16:00:00.000Z',
      expiresAt: '2026-08-31T17:00:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
      if (request.pathname.endsWith('/commands/cmd_application_1/input')) {
        return { inputHash: payloadHash, snapshot: sealedSnapshot } as never
      }
      return undefined as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}/agent/tools/business-tools/national-life-tools`,
    })

    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4,
      active: false,
      url: `${NLG}/agent/tools/business-tools/national-life-tools`,
    })
    await flush()
    expect(tabs.sendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
      type: 'OPEN_IGO_EAPP_FROM_TOOLS',
    }))

    emit('tabs.onUpdated', 5, { status: 'complete' }, {
      id: 5,
      active: false,
      url: 'https://igoforms2.ipipeline.com/CossEnterpriseSuite/session/WebForms/CaseListResp.aspx',
    })
    await flush()

    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalledWith(5, expect.objectContaining({
      type: 'EXECUTE_IGO_APPLICATION_DRAFT', payloadHash, snapshot: sealedSnapshot,
    })))
    const events = vi.mocked(signedJsonRequest).mock.calls
      .map(([request]) => request)
      .filter((request) => request.pathname.endsWith('/commands/cmd_application_1/events'))
      .map((request) => request.body as { type: string; payload?: unknown })
    expect(events.map((event) => event.type)).toEqual([
      'COMMAND_STARTED', 'DATA_BATCH', 'COMMAND_COMPLETED',
    ])
    expect(events[1]?.payload).toMatchObject({
      applicationDraft: { applicationId: snapshot.applicationId, progress: 'CASE_CREATED' },
    })
    expect(JSON.stringify(tabs.sendMessage.mock.calls)).not.toContain('SUBMIT_APPLICATION')
  })

  it('marks a carrier quote command failed when the page bridge refuses it', async () => {
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_quote_failed',
      request: {
        IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
        IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
        Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
        Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
      },
    } as const
    const inputHash = await sha256FlexLifeQuoteSnapshot(snapshot)
    const command = {
      protocolVersion: 1, commandId: 'cmd_quote_failed', runId: 'run_quote_failed',
      capability: 'FLEXLIFE_QUOTE', target: { kind: 'ILLUSTRATION', id: snapshot.illustrationId },
      params: { illustrationId: snapshot.illustrationId, inputHash },
      idempotencyKey: `quote:${snapshot.illustrationId}:${inputHash}`,
      issuedAt: '2026-08-26T17:00:00.000Z', expiresAt: '2026-08-26T18:00:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
      if (request.pathname.endsWith('/commands/cmd_quote_failed/input')) {
        return { inputHash, snapshot } as never
      }
      return undefined as never
    })
    tabs.sendMessage.mockImplementation(async (_tabId, value) => {
      const message = value as Record<string, unknown>
      if (message.type === 'EXECUTE_FLEXLIFE_QUOTE') return {
        ok: false, type: 'FLEXLIFE_QUOTE_FAILED', token: message.token,
        correlationId: message.correlationId, inputHash: message.inputHash,
        code: 'PORTAL_REQUEST_FAILED',
      } as never
      return defaultTabMessageResponse(_tabId, value)
    })
    await bootBackground()
    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4, active: false, url: `${NLG}/agent/tools/business-tools/illustrations`,
    })
    await flush()

    await vi.waitFor(() => {
      const failure = vi.mocked(signedJsonRequest).mock.calls
        .map(([request]) => request)
        .find((request) => request.pathname.endsWith('/commands/cmd_quote_failed/events') &&
          (request.body as { type?: string })?.type === 'COMMAND_FAILED')
      expect(failure?.body).toMatchObject({
        type: 'COMMAND_FAILED',
        error: { code: 'PORTAL_REQUEST_FAILED' },
      })
    })
  })

  it('executes only the signed and hash-matched approved Foresight snapshot', async () => {
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_123',
      caseId: 'case_123',
      carrierCaseName: 'KEEPRONE-20260826-ILL_123',
      insured: { firstName: 'KeeprOne', lastName: 'Test', dateOfBirth: '1990-01-01', issueState: 'FL' },
      product: { name: 'FlexLife', code: '956' },
      solve: { method: 'Specify_Amount', amount: 100_000 },
      faceAmount: 100_000,
      premium: { mode: 'Monthly', amount: 250 },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      deathBenefitOption: 'A_Level',
      allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
      riders: [
        'DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness',
        'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease',
      ],
      reports: ['NAIC_ILLUSTRATION'],
    } as const
    const inputHash = await sha256ForesightSnapshot(snapshot)
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_illustration_1',
      runId: 'run_illustration_1',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: snapshot.illustrationId },
      params: { illustrationId: snapshot.illustrationId, inputHash },
      idempotencyKey: `illustration:${snapshot.illustrationId}:${inputHash}`,
      issuedAt: '2026-08-26T17:00:00.000Z',
      expiresAt: '2026-08-26T17:30:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
      if (request.pathname.endsWith('/commands/cmd_illustration_1/input')) {
        return { inputHash, snapshot } as never
      }
      return undefined as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}/agent/sso/foresight`,
    })

    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4, active: false, url: `${NLG}/NWI/Main/Layout.aspx`,
    })
    await flush()

    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalled())
    expect(tabs.sendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
      type: 'EXECUTE_FORESIGHT_ILLUSTRATION', inputHash, snapshot,
    }))
    expect(signedBinaryRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'PUT',
      pathname: '/api/agent/integrations/national-life/local-connector/commands/cmd_illustration_1/artifact',
      contentType: 'application/pdf',
      body: FORESIGHT_PDF,
    }))
    const events = vi.mocked(signedJsonRequest).mock.calls
      .map(([request]) => request)
      .filter((request) => request.pathname.endsWith('/commands/cmd_illustration_1/events'))
      .map((request) => request.body as { type: string; payload?: unknown })
    expect(events.map((event) => event.type)).toEqual([
      'COMMAND_STARTED', 'DATA_BATCH', 'COMMAND_COMPLETED',
    ])
    expect(storage.command).toMatchObject({ status: 'COMPLETED', nextEventSequence: 4 })
  })

  it('resets the latest Foresight tab for a new or hash-mismatched illustration command', async () => {
    storage.command = { status: 'ERROR', carrierTabId: 12, termInputHash: 'b'.repeat(64) }
    tabs.query.mockResolvedValue([
      { id: 44, active: false, lastAccessed: 20, url: `${NLG}/NWI/Main/Layout.aspx` },
      { id: 45, active: false, lastAccessed: 10, url: `${NLG}/NWI/Main/Layout.aspx` },
      { id: 46, active: false, lastAccessed: 30, url: `${NLG}${COMMISSIONS_PATH}` },
    ])
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_illustration_reuse',
      runId: 'run_illustration_reuse',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'ill_reuse' },
      params: { illustrationId: 'ill_reuse', inputHash: 'a'.repeat(64) },
      idempotencyKey: 'illustration:reuse',
      issuedAt: '2026-08-27T18:00:00.000Z',
      expiresAt: '2026-08-27T18:30:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
    } as never)
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()

    expect(tabs.update).toHaveBeenCalledWith(44, { url: `${NLG}/agent/sso/foresight` })
    expect(tabs.create).not.toHaveBeenCalled()
    expect(storage.command).toMatchObject({ carrierTabId: 44, status: 'NAVIGATING' })
  })

  it('resumes only the exact interrupted Term case without reopening Foresight', async () => {
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_term_resume',
      caseId: null,
      carrierCaseName: 'KEEPRONE_TERM_RESUME',
      product: { carrierName: 'LSW Term', kind: 'TERM' },
      insured: { firstName: 'Synthetic', lastName: 'Test', dateOfBirth: '1990-01-01', issueState: 'FL' },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      faceAmount: 100_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
      reports: ['NAIC_ILLUSTRATION'],
    } as const
    const inputHash = await sha256ForesightTermSnapshot(snapshot)
    storage.command = {
      commandId: 'cmd_term_interrupted',
      runId: 'run_term_interrupted',
      carrierTabId: 44,
      termInputHash: inputHash,
      status: 'ERROR',
    }
    tabs.query.mockResolvedValue([
      { id: 44, active: false, lastAccessed: 20, url: `${NLG}/NWI/Main/Layout.aspx` },
    ])
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_term_resume',
      runId: 'run_term_resume',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: snapshot.illustrationId },
      params: { illustrationId: snapshot.illustrationId, inputHash },
      idempotencyKey: `illustration:${snapshot.illustrationId}:${inputHash}`,
      issuedAt: '2026-09-01T18:00:00.000Z',
      expiresAt: '2026-09-01T18:30:00.000Z',
      requiresConfirmation: true,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/commands/next')) return {
        command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
      } as never
      if (request.pathname.endsWith('/commands/cmd_term_resume/input')) {
        return { inputHash, snapshot } as never
      }
      return undefined as never
    })
    tabs.sendMessage.mockImplementationOnce(async (_tabId, message) => {
      const request = message as { type?: string; token: string; correlationId: string }
      if (request.type !== 'EXECUTE_FORESIGHT_ILLUSTRATION') return defaultTabMessageResponse(_tabId, message)
      return {
        ok: true,
        type: 'FORESIGHT_ILLUSTRATION_SAVED',
        token: request.token,
        correlationId: request.correlationId,
        receipt: {
          inputHash,
          caseFingerprint: `case_${'c'.repeat(64)}`,
          carrierCaseName: snapshot.carrierCaseName,
          carrierProduct: snapshot.product.carrierName,
          requestedTermDuration: snapshot.termDuration,
          confirmedTermDuration: snapshot.termDuration,
          release: '5.3.65.31',
          reportCode: 'NAIC_ILLUSTRATION',
          documentSha256: FORESIGHT_PDF_HASH,
          documentBytes: FORESIGHT_PDF.byteLength,
          saved: true,
        },
        document: { contentType: 'application/pdf', pdfBase64: FORESIGHT_PDF_BASE64 },
      }
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()

    expect(tabs.update).not.toHaveBeenCalledWith(44, { url: `${NLG}/agent/sso/foresight` })
    await vi.waitFor(() => expect(tabs.sendMessage).toHaveBeenCalled())
    expect(tabs.sendMessage).toHaveBeenCalledWith(44, expect.objectContaining({
      type: 'EXECUTE_FORESIGHT_ILLUSTRATION', inputHash, snapshot,
    }))
    await vi.waitFor(() => expect(storage.command).toMatchObject({
      status: 'COMPLETED', carrierTabId: 44,
    }))
  })

  it('executes an on-demand policy detail command in its own inactive tab', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_policy_1',
      runId: 'run_policy_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
      params: { policyNumber: 'LS1473219', navigatePath: POLICY_DETAIL_PATH },
      idempotencyKey: 'policy_1:detail:1',
      issuedAt: '2026-08-26T17:00:00.000Z',
      expiresAt: '2026-08-26T17:30:00.000Z',
      requiresConfirmation: false,
    }
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.pathname.endsWith('/commands/next')) {
        return {
          command,
          state: 'QUEUED',
          nextEventSequence: 1,
          lastEventType: 'COMMAND_ACCEPTED',
        } as never
      }
      return undefined as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({ active: false, url: `${NLG}${POLICY_DETAIL_PATH}` })
    expect(storage.command).toMatchObject({
      commandId: 'cmd_policy_1', carrierTabId: 4, status: 'NAVIGATING',
    })

    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4, active: false, url: `${NLG}${POLICY_DETAIL_PATH}`,
    })
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(4, expect.objectContaining({
      type: 'CAPTURE_POLICY_DETAIL', expectedPolicyNumber: 'LS1473219',
    }))
    const events = vi.mocked(signedJsonRequest).mock.calls
      .map(([input]) => input)
      .filter((input) => input.pathname.endsWith('/commands/cmd_policy_1/events'))
      .map((input) => input.body as { type?: string; payload?: unknown })
    expect(events.map((event) => event.type)).toEqual([
      'COMMAND_STARTED', 'DATA_BATCH', 'COMMAND_COMPLETED',
    ])
    expect(events[1]?.payload).toEqual(expect.objectContaining({
      policyDetail: expect.objectContaining({ visiblePolicyNumber: 'LS1473219' }),
    }))
    expect(storage.command).toMatchObject({ status: 'COMPLETED', nextEventSequence: 4 })
  })

  it('pauses for National Life login and resumes the same command after authentication', async () => {
    const command = {
      protocolVersion: 1,
      commandId: 'cmd_policy_auth',
      runId: 'run_policy_auth',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1' },
      params: { policyNumber: 'LS1473219', navigatePath: POLICY_DETAIL_PATH },
      idempotencyKey: 'policy_1:detail:auth',
      issuedAt: '2026-08-26T17:00:00.000Z',
      expiresAt: '2026-08-26T17:30:00.000Z',
      requiresConfirmation: false,
    }
    let cursor = 1
    let state = 'QUEUED'
    let lastEventType: string | null = 'COMMAND_ACCEPTED'
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.pathname.endsWith('/commands/next')) {
        return { command, state, nextEventSequence: cursor, lastEventType } as never
      }
      if (input.pathname.endsWith('/commands/cmd_policy_auth/events')) {
        const event = input.body as { sequence: number; type: string }
        cursor = event.sequence + 1
        lastEventType = event.type
        state = event.type === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'RUNNING'
      }
      return undefined as never
    })
    storage.command = {
      commandId: 'cmd_policy_auth', runId: 'run_policy_auth', carrierTabId: 4,
      nextEventSequence: 1, status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{ id: 4, active: false, url: `${NLG_AUTH0}/authorize` }])
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-command-poll' })
    await flush()
    expect(storage.command).toMatchObject({
      commandId: 'cmd_policy_auth', carrierTabId: 4, status: 'AUTH_REQUIRED', nextEventSequence: 2,
    })
    expect(tabs.update).toHaveBeenCalledWith(4, { active: true })

    emit('tabs.onUpdated', 4, { status: 'complete' }, {
      id: 4, active: true, url: `${NLG}${POLICY_DETAIL_PATH}`,
    })
    await flush()
    expect(storage.command).toMatchObject({
      commandId: 'cmd_policy_auth', status: 'COMPLETED', nextEventSequence: 5,
    })
    const eventTypes = vi.mocked(signedJsonRequest).mock.calls
      .map(([input]) => input)
      .filter((input) => input.pathname.endsWith('/commands/cmd_policy_auth/events'))
      .map((input) => (input.body as { type: string }).type)
    expect(eventTypes).toEqual([
      'AUTH_REQUIRED', 'COMMAND_STARTED', 'DATA_BATCH', 'COMMAND_COMPLETED',
    ])
  })

  it('starts a due daily sync from the extension alarm without the Keepr One page', async () => {
    storage.sync = {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-scheduled',
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
      nextStageIndex: 0,
    } as never)
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
      body: {},
    }))
    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(readSync()).toMatchObject({ runId: 'run-scheduled', status: 'NAVIGATING' })
  })

  it('does not repurpose a Foresight tab for a scheduled sync', async () => {
    storage.sync = {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    }
    tabs.query.mockResolvedValue([{ id: 44, active: false, url: `${NLG}/NWI/Main/Layout.aspx` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-scheduled',
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
      nextStageIndex: 0,
    } as never)
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(tabs.update).not.toHaveBeenCalledWith(44, expect.objectContaining({ url: expect.any(String) }))
  })

  it('drops a legacy sync binding that points at a Foresight tab', async () => {
    storage.sync = {
      carrierTabId: 44,
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    }
    tabs.query.mockResolvedValue([{ id: 44, active: false, url: `${NLG}/NWI/Main/Layout.aspx` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-scheduled',
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
      nextStageIndex: 0,
    } as never)
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(tabs.update).not.toHaveBeenCalledWith(44, expect.objectContaining({ url: expect.any(String) }))
  })

  it('starts a scheduled sync in its own tab while an illustration command is running', async () => {
    storage.sync = {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    }
    storage.command = {
      commandId: 'cmd_illustration_active',
      runId: 'run_illustration_active',
      carrierTabId: 44,
      status: 'RUNNING',
    }
    tabs.query.mockResolvedValue([{ id: 44, active: false, url: `${NLG}/NWI/Main/Layout.aspx` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-scheduled',
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
      nextStageIndex: 0,
    } as never)
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
    }))
    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(tabs.update).not.toHaveBeenCalledWith(44, expect.objectContaining({ url: expect.any(String) }))
  })

  it('does not start another scheduled sync while the last completion is fresh', async () => {
    storage.sync = {
      status: 'COMPLETED',
      completedAt: new Date(Date.now() - 23 * 60 * 60_000).toISOString(),
    }
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(signedJsonRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
    }))
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('reclaims a timed-out auth wait and keeps the server checkpoint', async () => {
    storage.sync = {
      runId: 'run-resume',
      plan: THREE_STAGE_PLAN,
      stageIndex: 1,
      carrierTabId: 7,
      status: 'AUTH_REQUIRED',
      authRenewalPending: true,
      authRequiredAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      credentialAttempt: {
        operationKind: 'SYNC_RUN', operationId: 'run-resume', authEpoch: 1,
        leaseId: 'lease-old', attemptedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      },
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG_AUTH0}/login?state=stale` }])
    vi.mocked(signedJsonRequest).mockImplementation(async (request) => {
      if (request.pathname.endsWith('/runs')) return {
        runId: 'run-resume',
        stages: THREE_STAGE_PLAN,
        completedStages: 1,
        nextStageIndex: 1,
        reopened: true,
      } as never
      if (request.pathname.endsWith('/auth-state')) return { authEpoch: 2 } as never
      return {} as never
    })
    await bootBackground()

    emit('alarms.onAlarm', { name: 'keeprone-national-life-scheduled-sync' })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
    }))
    expect(readSync()).toMatchObject({
      runId: 'run-resume', stageIndex: 1, status: 'AUTH_REQUIRED',
      authRenewalPending: true,
    })
    expect(readSync().credentialAttempt).toBeUndefined()
    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-resume/auth-state',
      body: { state: 'REQUIRED' },
    }))
  })

  it('forwards an explicit full refresh to the run endpoint', async () => {
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-full',
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
      nextStageIndex: 0,
    } as never)
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC', forceRefresh: true },
      EXTERNAL_SENDER,
      vi.fn(),
    )
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
      body: { forceRefresh: true },
    }))
  })

  it('captures and uploads a READ_PAGE source without a DataTables request', async () => {
    const pagePlan = [{
      capability: 'READ_PAGE',
      params: { sourceKey: 'AGENT_DASHBOARD', navigatePath: '/agent/' },
    }]
    storage.sync = {
      runId: 'run-page', carrierTabId: 7, plan: pagePlan, stageIndex: 0, status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}/agent/` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({} as never)

    await bootBackground()
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'CAPTURE_PAGE', sourceKey: 'AGENT_DASHBOARD' }),
    )
    await vi.waitFor(() => {
      expect(vi.mocked(signedJsonRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          pathname: '/api/agent/integrations/national-life/local-connector/runs/run-page/stages/AGENT_DASHBOARD',
          body: expect.objectContaining({
            gridKey: 'AGENT_DASHBOARD',
            recordsTotal: 1,
            records: [{ RecordType: 'PAGE_META', Title: 'Agent dashboard' }],
          }),
        }),
      )
    }, { timeout: 3_000 })
    expect(readSync()).toMatchObject({ runId: 'run-page', status: 'COMPLETED' })
  })

  it('advances to the next stage of the plan when a grid finishes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    const begin = beginGridMessage()
    expect(begin).toMatchObject({ type: 'BEGIN_GRID', gridKey: 'NEW_BUSINESS' })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK', gridKey: 'NEW_BUSINESS', token: begin.token,
        correlationId: begin.correlationId, sequence: 0, recordsTotal: 1,
        truncated: false, records: [{ PolicyNo: 'NB-1' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` }, vi.fn(),
    )

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ runId: 'run-1', stageIndex: 1, status: 'NAVIGATING' })
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${INFORCE_PATH}` })
  })

  it('records a portal-source failure and continues without failing the whole run', async () => {
    storage.sync = {
      runId: 'run-1', carrierTabId: 7, plan: THREE_STAGE_PLAN, stageIndex: 1, status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{
      id: 7, active: false, url: `${NLG}${PAYABLE_PERSONAL_PATH}`,
    }])
    vi.mocked(signedJsonRequest).mockResolvedValue({ nextStageIndex: 2, terminal: false } as never)
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_ERROR',
        gridKey: 'PROJECTED_COMMISSIONS',
        token: begin.token,
        correlationId: begin.correlationId,
        code: 'TEMPLATE_UNAVAILABLE',
      },
      { tab: { id: 7 }, url: `${NLG}${PROJECTED_COMMISSIONS_PATH}` },
      vi.fn(),
    )
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-1/stages/PROJECTED_COMMISSIONS/fail',
      body: {
        runId: 'run-1',
        gridKey: 'PROJECTED_COMMISSIONS',
        code: 'TEMPLATE_UNAVAILABLE',
        retryable: true,
      },
    }))
    expect(readSync()).toMatchObject({ runId: 'run-1', stageIndex: 2, status: 'NAVIGATING' })
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${INFORCE_PATH}` })
  })

  it('completes the run when the last stage of the plan finishes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    const begin = beginGridMessage()
    expect(begin).toMatchObject({ gridKey: 'INFORCE_CLIENTS' })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK', gridKey: 'INFORCE_CLIENTS', token: begin.token,
        correlationId: begin.correlationId, sequence: 0, recordsTotal: 1,
        truncated: false, records: [{ PolicyNumber: 'IF-1' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` }, vi.fn(),
    )

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'INFORCE_CLIENTS',
        token: begin.token,
        correlationId: begin.correlationId,
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    // A data de conclusão é o que impede a página de dizer "concluído" para
    // sempre: sem ela, um COMPLETED grudento não tem como ser datado.
    expect(readSync()).toMatchObject({ runId: 'run-1', status: 'COMPLETED' })
    expect(typeof readSync().completedAt).toBe('string')
    expect(readSync().plan).toBeUndefined()
  })

  it('drops the pairing only when the server says the device is revoked', async () => {
    // Um 401 genérico não basta: ele cobre relógio fora da janela, que persiste
    // depois de reparear. Só a afirmação explícita solta o pareamento.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    const { SignedRequestError } = await import('../lib/signed-client')
    vi.mocked(signedJsonRequest).mockRejectedValue(
      new (SignedRequestError as unknown as new (code: string) => Error)('DEVICE_REVOKED'),
    )
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(storage.device).toMatchObject({ status: 'UNPAIRED' })
    expect(storage.device).not.toHaveProperty('deviceId')
    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'DEVICE_REVOKED' })
  })

  it('keeps the pairing on a bare rejection, which may be nothing but clock skew', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    const { SignedRequestError } = await import('../lib/signed-client')
    vi.mocked(signedJsonRequest).mockRejectedValue(
      new (SignedRequestError as unknown as new (code: string) => Error)(
        'DEVICE_REQUEST_REJECTED',
      ),
    )
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(storage.device).toMatchObject({ status: 'READY', deviceId: 'device-1' })
    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'DEVICE_REQUEST_REJECTED' })
  })

  it('counts uploaded batches so a long single stage still proves it is alive', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue(undefined as never)
    await bootBackground()
    const begin = beginGridMessage()

    for (const sequence of [0, 1]) {
      emit(
        'runtime.onMessage',
        {
          type: 'GRID_CHUNK',
          gridKey: 'NEW_BUSINESS',
          token: begin.token,
          correlationId: begin.correlationId,
          sequence,
          recordsTotal: 2,
          truncated: sequence === 0,
          records: [{ a: 'b' }],
        },
        { tab: { id: 7 }, url: `${NLG}/agent/anything` },
        vi.fn(),
      )
      await flush()
    }

    expect(readSync()).toMatchObject({ status: 'UPLOADING', stageIndex: 0, uploads: 2 })
  })

  it('keeps an idempotent chunk body stable across a transient retry', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-31T14:08:43.000Z') })
    try {
      storage.sync = {
        runId: 'run-retry', carrierTabId: 7, plan: TWO_STAGE_PLAN,
        stageIndex: 0, status: 'NAVIGATING',
      }
      tabs.query.mockResolvedValue([{
        id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}`,
      }])

      const attempts: Array<{ idempotencyKey?: string; body: unknown }> = []
      vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
        if (input.method !== 'PUT') return {} as never
        attempts.push({ idempotencyKey: input.idempotencyKey, body: input.body })
        if (attempts.length === 1) {
          throw new SignedRequestError('DEVICE_REQUEST_FAILED')
        }
        return { duplicate: true } as never
      })
      vi.mocked(retryIdempotentSignedRequest).mockImplementationOnce(async ({ request }) => {
        try {
          await request()
        } catch {
          vi.advanceTimersByTime(1_000)
        }
        return request()
      })

      await bootBackground()
      const begin = beginGridMessage()
      emit(
        'runtime.onMessage',
        {
          type: 'GRID_CHUNK',
          gridKey: 'NEW_BUSINESS',
          token: begin.token,
          correlationId: begin.correlationId,
          sequence: 0,
          sourceOffset: 0,
          nextOffset: 100,
          recordsTotal: 841,
          truncated: false,
          records: [{ PolicyNumber: 'LS123' }],
        },
        { tab: { id: 7 }, url: `${NLG}${NEW_BUSINESS_PATH}` },
        vi.fn(),
      )
      await flush()

      expect(attempts.map((attempt) => attempt.idempotencyKey)).toEqual([
        'nlc:run-retry:0:NEW_BUSINESS:0',
        'nlc:run-retry:0:NEW_BUSINESS:0',
      ])
      expect(JSON.stringify(attempts[1]?.body)).toBe(JSON.stringify(attempts[0]?.body))
      expect(readSync()).toMatchObject({ status: 'UPLOADING', uploads: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes mid-plan after the service worker is evicted', async () => {
    // Nothing survives eviction except chrome.storage: the plan and the index in it are
    // the whole of what the next boot knows about the run.
    storage.sync = { runId: 'run-1', carrierTabId: 9, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'EXTRACTING' }
    tabs.query.mockResolvedValue([{ id: 9, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'INFORCE_CLIENTS' }),
    )
    expect(readSync()).toMatchObject({ stageIndex: 1, status: 'EXTRACTING' })
  })

  it('passes the server batch checkpoint into the resumed extraction', async () => {
    storage.sync = {
      runId: 'run-1',
      carrierTabId: 9,
      plan: TWO_STAGE_PLAN,
      stageIndex: 1,
      status: 'ERROR',
    }
    tabs.query.mockResolvedValue([{ id: 9, active: true, url: `${NLG}${INFORCE_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-1',
      schemaVersion: 3,
      stages: TWO_STAGE_PLAN,
      duplicate: true,
      completedStages: 1,
      resume: { sequence: 3, offset: 600 },
    } as never)
    await bootBackground()
    const sendResponse = vi.fn()
    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, sendResponse)
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        type: 'BEGIN_GRID',
        gridKey: 'INFORCE_CLIENTS',
        sequenceStart: 3,
        offsetStart: 600,
      }),
    )
  })

  it('rebuilds a commission-detail retry from the server statement cursor', async () => {
    storage.sync = {
      runId: 'run-commission-detail',
      carrierTabId: 11,
      plan: COMMISSION_DETAIL_PLAN,
      stageIndex: 1,
      status: 'ERROR',
      commissionDetailLinks: [
        { path: COMMISSION_DETAIL_PATH, statementId: 'aaa1' },
        { path: COMMISSION_DETAIL_PATH_2, statementId: 'bbb2' },
      ],
      commissionDetailIndex: 1,
      // The inconsistent local cursor observed in production: the global
      // offset advanced, but the child-page index did not.
      commissionDetailOffset: 2273,
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}${COMMISSIONS_EARNING_REPORT_PATH}`,
    }])
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.pathname === '/api/agent/integrations/national-life/local-connector/runs') {
        return {
          runId: 'run-commission-detail',
          schemaVersion: 3,
          stages: COMMISSION_DETAIL_PLAN,
          duplicate: true,
          completedStages: 1,
          nextStageIndex: 1,
          resume: { sequence: 13, offset: 2273, recordCount: 2273 },
        } as never
      }
      if (input.pathname.endsWith('/details')) {
        return {
          links: [
            { path: COMMISSION_DETAIL_PATH, statementId: 'aaa1' },
            { path: COMMISSION_DETAIL_PATH_2, statementId: 'bbb2' },
          ],
          resume: {
            statementId: 'bbb2',
            statementOffset: 664,
            baseOffset: 1609,
            sequence: 13,
            receivedRecordCount: 2273,
          },
        } as never
      }
      return {} as never
    })
    await bootBackground()

    const sendResponse = vi.fn()
    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, sendResponse)
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())

    expect(readSync()).toMatchObject({
      commissionDetailIndex: 1,
      commissionDetailOffset: 1609,
      commissionDetailCurrentOffset: 664,
      commissionDetailReceivedRecords: 2273,
      resumeSequence: 13,
      resumeOffset: 664,
      status: 'NAVIGATING',
    })
    expect(tabs.update).toHaveBeenLastCalledWith(11, {
      url: `${NLG}${COMMISSION_DETAIL_PATH_2}`,
    })
  })

  it('stops a mixed-version retry when the server omits the statement cursor', async () => {
    storage.sync = {
      runId: 'run-commission-detail',
      carrierTabId: 11,
      plan: COMMISSION_DETAIL_PLAN,
      stageIndex: 1,
      status: 'ERROR',
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}${COMMISSIONS_EARNING_REPORT_PATH}`,
    }])
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.pathname === '/api/agent/integrations/national-life/local-connector/runs') {
        return {
          runId: 'run-commission-detail',
          stages: COMMISSION_DETAIL_PLAN,
          completedStages: 1,
          nextStageIndex: 1,
          resume: { sequence: 13, offset: 2273, recordCount: 2273 },
        } as never
      }
      if (input.pathname.endsWith('/details')) {
        return {
          links: [{ path: COMMISSION_DETAIL_PATH, statementId: 'aaa1' }],
        } as never
      }
      return {} as never
    })
    await bootBackground()

    const sendResponse = vi.fn()
    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, sendResponse)
    await vi.waitFor(() => expect(readSync()).toMatchObject({
      status: 'ERROR',
      errorCode: 'COMMISSION_DETAIL_CURSOR_UNAVAILABLE',
    }))
    expect(sendResponse).toHaveBeenCalled()
    expect(tabs.update).not.toHaveBeenCalledWith(11, {
      url: `${NLG}${COMMISSION_DETAIL_PATH}`,
    })
  })

  it('recovers one commission-detail idempotency race without making the agent restart the sync', async () => {
    storage.sync = {
      runId: 'run-commission-detail',
      carrierTabId: 11,
      plan: COMMISSION_DETAIL_PLAN,
      stageIndex: 1,
      status: 'NAVIGATING',
      commissionDetailLinks: [
        { path: COMMISSION_DETAIL_PATH, statementId: 'aaa1' },
        { path: COMMISSION_DETAIL_PATH_2, statementId: 'bbb2' },
      ],
      commissionDetailIndex: 1,
      commissionDetailOffset: 1609,
      commissionDetailCurrentOffset: 664,
      resumeSequence: 13,
      resumeOffset: 664,
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}${COMMISSION_DETAIL_PATH_2}`,
    }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.method === 'PUT') throw new SignedRequestError('IDEMPOTENCY_CONFLICT')
      if (input.pathname === '/api/agent/integrations/national-life/local-connector/runs') {
        return {
          runId: 'run-commission-detail',
          stages: COMMISSION_DETAIL_PLAN,
          completedStages: 1,
          nextStageIndex: 1,
          resume: { sequence: 13, offset: 2273, recordCount: 2273 },
        } as never
      }
      return {} as never
    })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 12,
        recordsTotal: 664,
        truncated: false,
        sourceOffset: 600,
        nextOffset: 664,
        records: [{ GrossCommEarned: '$20.00' }],
      },
      { tab: { id: 11 }, url: `${NLG}${COMMISSION_DETAIL_PATH_2}` },
      vi.fn(),
    )

    await vi.waitFor(() => expect(readSync()).toMatchObject({
      status: 'NAVIGATING',
      commissionDetailRecoveryAttempts: 1,
      resumeSequence: 13,
    }))
    expect(signedJsonRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      pathname: expect.stringMatching(/\/fail$/),
    }))
    expect(tabs.update).toHaveBeenLastCalledWith(11, {
      url: `${NLG}${COMMISSIONS_EARNING_REPORT_PATH}`,
    })
  })

  it('resumes an ordinary grid from the server cursor after an idempotency race', async () => {
    storage.sync = {
      runId: 'run-grid-race',
      carrierTabId: 11,
      plan: TWO_STAGE_PLAN,
      stageIndex: 0,
      status: 'NAVIGATING',
      resumeSequence: 0,
      resumeOffset: 0,
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.method === 'PUT') throw new SignedRequestError('IDEMPOTENCY_CONFLICT')
      if (input.pathname === '/api/agent/integrations/national-life/local-connector/runs') {
        return {
          runId: 'run-grid-race',
          stages: TWO_STAGE_PLAN,
          completedStages: 0,
          nextStageIndex: 0,
          resume: { sequence: 1, offset: 100, recordCount: 100 },
        } as never
      }
      return {} as never
    })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 857,
        truncated: false,
        sourceOffset: 0,
        nextOffset: 100,
        records: [{ PolicyNumber: 'LS123' }],
      },
      { tab: { id: 11 }, url: `${NLG}${NEW_BUSINESS_PATH}` },
      vi.fn(),
    )

    await vi.waitFor(() => expect(readSync()).toMatchObject({
      runId: 'run-grid-race',
      resumeSequence: 1,
      resumeOffset: 100,
      idempotencyRecoveryGridKey: 'NEW_BUSINESS',
      idempotencyRecoveryAttempts: 1,
    }))
    expect(readSync().status).not.toBe('ERROR')
    expect(signedJsonRequest).not.toHaveBeenCalledWith(expect.objectContaining({
      pathname: expect.stringMatching(/\/fail$/),
    }))
  })

  it('accepts the redirected in-force route for a run with the legacy plan path', async () => {
    storage.sync = {
      runId: 'run-legacy-route',
      carrierTabId: 9,
      plan: LEGACY_INFORCE_STAGE_PLAN,
      stageIndex: 1,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{ id: 9, active: false, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'INFORCE_CLIENTS' }),
    )
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ stageIndex: 1, status: 'EXTRACTING' })
  })

  it('starts paid commissions after the portal redirects its menu route', async () => {
    storage.sync = {
      runId: 'run-paid-redirect',
      carrierTabId: 11,
      plan: PAID_COMMISSIONS_REDIRECT_PLAN,
      stageIndex: 0,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}/agent/compensation/commissions/paid-commissions/commissions-earning-report`,
    }])
    await bootBackground()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'PAID_COMMISSIONS' }),
    )
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ stageIndex: 0, status: 'EXTRACTING' })
  })

  it('opens every stored earning link and persists its statement id across one stage', async () => {
    storage.sync = {
      runId: 'run-commission-detail',
      carrierTabId: 11,
      plan: COMMISSION_DETAIL_PLAN,
      stageIndex: 1,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{
      id: 11,
      active: false,
      url: `${NLG}${COMMISSIONS_EARNING_REPORT_PATH}`,
    }])
    vi.mocked(signedJsonRequest).mockImplementation(async (input) => {
      if (input.pathname.endsWith('/details')) {
        return {
          parentRows: 2,
          links: [
            { path: COMMISSION_DETAIL_PATH, statementId: 'aaa1' },
            { path: COMMISSION_DETAIL_PATH_2, statementId: 'bbb2' },
          ],
        } as never
      }
      if (input.pathname.endsWith('/complete')) return { terminal: true } as never
      return { duplicate: false } as never
    })

    await bootBackground()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname:
        '/api/agent/integrations/national-life/local-connector/runs/run-commission-detail/stages/COMMISSIONS_EARNING_REPORT/details',
    }))
    expect(tabs.update).toHaveBeenCalledWith(11, { url: `${NLG}${COMMISSION_DETAIL_PATH}` })

    emit('tabs.onUpdated', 11, { status: 'complete' }, { url: `${NLG}${COMMISSION_DETAIL_PATH}` })
    await flush()
    const firstBegin = beginGridMessage()
    expect(firstBegin).toMatchObject({
      type: 'BEGIN_GRID',
      gridKey: 'COMMISSIONS_EARNING_REPORT',
    })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        token: firstBegin.token,
        correlationId: firstBegin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        sourceOffset: 0,
        nextOffset: 1,
        records: [{ PolicyNumber: 'P1', GrossCommEarned: '$10.00' }],
      },
      { tab: { id: 11 }, url: `${NLG}${COMMISSION_DETAIL_PATH}` },
      vi.fn(),
    )
    await flush()
    const firstUpload = vi.mocked(signedJsonRequest).mock.calls.find((call) =>
      call[0].method === 'PUT' && call[0].pathname.endsWith('/COMMISSIONS_EARNING_REPORT'),
    )?.[0]
    expect(firstUpload?.body).toMatchObject({
      records: [{ PolicyNumber: 'P1', CommissionStatementId: 'aaa1' }],
      sourceOffset: 0,
      nextOffset: 1,
    })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        token: firstBegin.token,
        correlationId: firstBegin.correlationId,
      },
      { tab: { id: 11 }, url: `${NLG}${COMMISSION_DETAIL_PATH}` },
      vi.fn(),
    )
    await flush()
    expect(tabs.update).toHaveBeenLastCalledWith(11, { url: `${NLG}${COMMISSION_DETAIL_PATH_2}` })
    expect(readSync()).toMatchObject({
      commissionDetailIndex: 1,
      commissionDetailOffset: 1,
      resumeSequence: 1,
    })

    emit('tabs.onUpdated', 11, { status: 'complete' }, { url: `${NLG}${COMMISSION_DETAIL_PATH_2}` })
    await flush()
    const secondBegin = beginGridMessage()
    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        token: secondBegin.token,
        correlationId: secondBegin.correlationId,
        sequence: 1,
        recordsTotal: 1,
        truncated: false,
        sourceOffset: 0,
        nextOffset: 1,
        records: [{ PolicyNumber: 'P1', GrossCommEarned: '$20.00' }],
      },
      { tab: { id: 11 }, url: `${NLG}${COMMISSION_DETAIL_PATH_2}` },
      vi.fn(),
    )
    await flush()
    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'COMMISSIONS_EARNING_REPORT',
        token: secondBegin.token,
        correlationId: secondBegin.correlationId,
      },
      { tab: { id: 11 }, url: `${NLG}${COMMISSION_DETAIL_PATH_2}` },
      vi.fn(),
    )
    await flush()

    const detailUploads = vi.mocked(signedJsonRequest).mock.calls
      .filter((call) => call[0].method === 'PUT' && call[0].pathname.endsWith('/COMMISSIONS_EARNING_REPORT'))
      .map((call) => call[0].body as { records: Array<Record<string, unknown>>; sourceOffset: number })
    expect(detailUploads.map((upload) => upload.records[0]?.CommissionStatementId)).toEqual(['aaa1', 'bbb2'])
    expect(detailUploads[1]?.sourceOffset).toBe(1)
    expect(vi.mocked(signedJsonRequest)).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname:
        '/api/agent/integrations/national-life/local-connector/runs/run-commission-detail/stages/COMMISSIONS_EARNING_REPORT/complete',
      body: expect.objectContaining({ expectedRecordCount: 2, finalSequence: 1 }),
    }))
    expect(readSync()).toMatchObject({ status: 'COMPLETED' })
  })

  it('starts a legacy projected stage on the payable personal report', async () => {
    storage.sync = {
      runId: 'run-projected-redirect',
      carrierTabId: 12,
      plan: THREE_STAGE_PLAN,
      stageIndex: 1,
      status: 'NAVIGATING',
    }
    tabs.query.mockResolvedValue([{
      id: 12,
      active: false,
      url: `${NLG}${PAYABLE_PERSONAL_PATH}`,
    }])
    await bootBackground()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      12,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'PROJECTED_COMMISSIONS' }),
    )
    expect(tabs.update).not.toHaveBeenCalled()
  })

  it('isolates a source after repeated unexpected carrier redirects', async () => {
    storage.sync = {
      runId: 'run-route-loop',
      carrierTabId: 7,
      plan: TWO_STAGE_PLAN,
      stageIndex: 0,
      status: 'NAVIGATING',
    }
    const unexpected = `${NLG}/agent/unexpected-report`
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: unexpected }])
    vi.mocked(signedJsonRequest).mockResolvedValue({ nextStageIndex: 1, terminal: false } as never)
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { url: unexpected })
    await flush()
    emit('tabs.onUpdated', 7, { status: 'complete' }, { url: unexpected })
    await flush()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-route-loop/stages/NEW_BUSINESS/fail',
      body: {
        runId: 'run-route-loop',
        gridKey: 'NEW_BUSINESS',
        code: 'PORTAL_ROUTE_CHANGED',
        retryable: true,
      },
    }))
    expect(readSync()).toMatchObject({ stageIndex: 1, status: 'NAVIGATING' })
  })

  it('returns to the current stage when a stale carrier page is open', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    emit(
      'tabs.onUpdated',
      7,
      { status: 'complete' },
      { url: `${NLG}${INFORCE_PATH}` },
    )
    await flush()

    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ stageIndex: 0, status: 'NAVIGATING' })
  })

  it('retries a temporarily locked Chrome tab instead of abandoning the sync', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${INFORCE_PATH}` }])
    tabs.update
      .mockRejectedValueOnce(new Error('Tabs cannot be edited right now (user may be dragging a tab).'))
      .mockResolvedValue(undefined)

    await bootBackground()
    await new Promise((resolve) => setTimeout(resolve, 75))

    expect(tabs.update).toHaveBeenCalledTimes(2)
    expect(tabs.update).toHaveBeenLastCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ status: 'NAVIGATING', stageIndex: 0 })
  })

  it('reuses the visible carrier tab instead of opening a second one', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ carrierTabId: 7, status: 'NAVIGATING' })
  })

  it('binds an already-open National Life tab when the stored tab id is missing', async () => {
    storage.sync = { runId: 'run-1', plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ carrierTabId: 7, status: 'NAVIGATING' })
  })

  it('starts extraction when Check again finds the current grid already open', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-1',
      schemaVersion: 3,
      stages: TWO_STAGE_PLAN,
      duplicate: true,
    } as never)
    await bootBackground()
    tabs.sendMessage.mockClear()
    storage.sync = { ...readSync(), status: 'NAVIGATING' }

    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, vi.fn())
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'NEW_BUSINESS' }),
    )
    expect(readSync()).toMatchObject({ status: 'EXTRACTING', stageIndex: 0 })
  })

  it('goes to AUTH_REQUIRED instead of extracting on an auth interstitial', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}/agent/auth/login` }])
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { url: `${NLG}/agent/auth/login` })
    await flush()

    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED', authRenewalPending: true })
    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-1/auth-state',
      body: { state: 'REQUIRED' },
    }))
  })

  it('resumes the pending grid when login returns to the authenticated agent shell', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'AUTH_REQUIRED', authRenewalPending: true }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}/agent/` }])
    await bootBackground()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ status: 'NAVIGATING', stageIndex: 0 })
  })

  it('resolves the Keepr One login warning after a verified carrier session returns', async () => {
    storage.sync = {
      runId: 'run-1',
      carrierTabId: 7,
      plan: TWO_STAGE_PLAN,
      stageIndex: 0,
      status: 'NAVIGATING',
      authRenewalPending: true,
    }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    expect(signedJsonRequest).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/api/agent/integrations/national-life/local-connector/runs/run-1/auth-state',
      body: { state: 'RESTORED' },
    }))
    expect(readSync()).toMatchObject({ status: 'EXTRACTING', authRenewalPending: false })
  })

  it('stops cleanly when the carrier tab is closed instead of reopening it', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'EXTRACTING' }
    tabs.query.mockResolvedValueOnce([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    emit('tabs.onRemoved', 7)
    await flush()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ runId: 'run-1', stageIndex: 0, status: 'ERROR', errorCode: 'CONNECTOR_TAB_CLOSED' })
  })

  it('does not re-navigate the connector when an unrelated tab closes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'EXTRACTING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    tabs.create.mockClear()
    tabs.update.mockClear()

    emit('tabs.onRemoved', 99)
    await flush()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ carrierTabId: 7, status: 'EXTRACTING' })
  })

  it('keeps the Auth0 login tab instead of opening another login', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 12, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'AUTH_REQUIRED' }
    tabs.query.mockResolvedValue([{ id: 12, active: true, url: `${NLG_AUTH0}/login?state=pending` }])
    await bootBackground()

    // A build loaded after this page opened needs one reload to inject the
    // current login handler. It must still neither open another tab nor steal
    // focus through tabs.update.
    expect(tabs.reload).toHaveBeenCalledTimes(1)
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.create).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED', stageIndex: 0 })
  })

  it('does not spend run-start attempts while login or MFA is pending', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 12, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'AUTH_REQUIRED' }
    tabs.query.mockResolvedValue([{ id: 12, active: true, url: `${NLG_AUTH0}/login?state=pending` }])
    await bootBackground()
    vi.mocked(signedJsonRequest).mockClear()
    tabs.update.mockClear()

    for (let minute = 0; minute < 15; minute += 1) {
      emit('alarms.onAlarm', { name: 'keeprone-national-life-sync-watchdog' })
      await flush()
    }

    expect(signedJsonRequest).not.toHaveBeenCalled()
    expect(tabs.reload).toHaveBeenCalledTimes(1)
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED', runId: 'run-1' })
  })

  it('releases the start lock after a sync request settles', async () => {
    storage.sync = { status: 'IDLE' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-1',
      schemaVersion: 3,
      stages: TWO_STAGE_PLAN,
      completedStages: 0,
    } as never)
    await bootBackground()
    const firstResponse = vi.fn()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, firstResponse)
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalled())

    const secondResponse = vi.fn()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, secondResponse)
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalled())

    expect(secondResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })

  it('returns to login instead of extracting when the session probe fails', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
      const value = message as { type?: string; token?: string; correlationId?: string }
      if (value.type === 'PROBE_AUTH') {
        return {
          ok: true,
          type: 'AUTH_PROBED',
          token: value.token,
          correlationId: value.correlationId,
          authenticated: false,
        }
      }
      return defaultTabMessageResponse(_tabId, message)
    })
    await bootBackground()

    expect(tabs.sendMessage).not.toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'BEGIN_GRID' }),
    )
    expect(tabs.update).toHaveBeenCalledWith(7, {
      active: true,
      url: `${NLG}/agent/auth/login`,
    })
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED', stageIndex: 0 })
  })

  it('starts a fresh run when the stored state predates the plan shape', async () => {
    // This is the whole storage migration: an installed extension holds `nextGrid`, not
    // a plan. Every guard reads currentStage(), so the old shape is simply "no run in
    // progress" and the server hands back the plan for the run it already has open.
    storage.sync = { runId: 'run-old', nextGrid: 'NEW_BUSINESS', status: 'NAVIGATING' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-old',
      schemaVersion: 2,
      stages: TWO_STAGE_PLAN,
      duplicate: true,
    } as never)
    await bootBackground()

    const sendResponse = vi.fn()
    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      sendResponse,
    )
    await flush()

    expect(vi.mocked(signedJsonRequest).mock.calls[0]![0]).toMatchObject({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
    })
    expect(readSync()).toMatchObject({
      runId: 'run-old',
      stageIndex: 0,
      status: 'NAVIGATING',
      plan: TWO_STAGE_PLAN,
    })
  })

  it('refuses to navigate on a stored plan that no longer validates', async () => {
    // Storage survives extension updates, so a plan is revalidated on every read. A
    // path outside the agent tree degrades to "no plan" instead of steering a tab.
    storage.sync = {
      runId: 'run-1',
      plan: [{ capability: 'READ_GRID', params: { gridKey: 'X', navigatePath: '/NWI/admin' } }],
      stageIndex: 0,
      status: 'NAVIGATING',
    }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-2',
      schemaVersion: 2,
      stages: TWO_STAGE_PLAN,
      duplicate: false,
    } as never)
    await bootBackground()

    // resumePending saw no usable stage, so nothing was navigated.
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.create).not.toHaveBeenCalled()

    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ runId: 'run-2', stageIndex: 0, status: 'NAVIGATING' })
  })

  it('rejects a run response whose stage plan is not safe', async () => {
    storage.sync = { status: 'IDLE' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-3',
      schemaVersion: 2,
      stages: [
        { capability: 'READ_GRID', params: { gridKey: 'X', navigatePath: 'https://evil.example/agent/x' } },
      ],
      duplicate: false,
    } as never)
    await bootBackground()

    const sendResponse = vi.fn()
    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      sendResponse,
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'UNSAFE_NAVIGATE_PATH' })
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('drives a plan carrying a grid the extension has no knowledge of', async () => {
    // The payoff: a grid that never appeared in any extension release is navigated and
    // extracted purely from the plan.
    storage.sync = { status: 'IDLE' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-4',
      schemaVersion: 2,
      stages: [
        {
          capability: 'READ_GRID',
          params: { gridKey: 'PAID_COMMISSIONS', navigatePath: COMMISSIONS_PATH },
        },
      ],
      duplicate: false,
    } as never)
    await bootBackground()

    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      vi.fn(),
    )
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({ active: false, url: `${NLG}${COMMISSIONS_PATH}` })

    emit('tabs.onUpdated', 4, { status: 'complete' }, { url: `${NLG}${COMMISSIONS_PATH}` })
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'PAID_COMMISSIONS' }),
    )
  })

  it('uploads raw rows under schemaVersion 3 with a stage-scoped idempotency key', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({} as never)
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'INFORCE_CLIENTS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNumber: 'NL-1', Anything: { nested: true } }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    const request = vi.mocked(signedJsonRequest).mock.calls[0]![0]
    expect(request).toMatchObject({
      method: 'PUT',
      pathname:
        '/api/agent/integrations/national-life/local-connector/runs/run-1/stages/INFORCE_CLIENTS',
      idempotencyKey: 'nlc:run-1:1:INFORCE_CLIENTS:0',
    })
    expect(request.body).toMatchObject({
      schemaVersion: 3,
      gridKey: 'INFORCE_CLIENTS',
      records: [{ PolicyNumber: 'NL-1', Anything: { nested: true } }],
    })
  })
})
