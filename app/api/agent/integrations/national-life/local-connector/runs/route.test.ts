import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  pageDiscoveryEnabled: vi.fn(),
  exportEnabled: vi.fn(),
  mockVerify: vi.fn(),
  mockStartRun: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  isNationalLifePageDiscoveryEnabled: mocks.pageDiscoveryEnabled,
  isNationalLifeExportEnabled: mocks.exportEnabled,
  localConnectorUnavailableResponse: () =>
    Response.json(
      { error: 'NOT_AVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    ),
}))
vi.mock('@/lib/national-life/local-connector/device-signature', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/national-life/local-connector/device-signature')
  >('@/lib/national-life/local-connector/device-signature')
  return {
    ...actual,
    verifyLocalConnectorDeviceRequest: mocks.mockVerify,
  }
})
vi.mock('@/lib/national-life/local-connector/run-service', () => ({
  LOCAL_CONNECTOR_PRIORITY_GRID_KEYS: [
    'NEW_BUSINESS',
    'RECENTLY_CLOSED',
    'INFORCE_CLIENTS',
    'PAID_COMMISSIONS',
    'COMMISSIONS_EARNING_REPORT',
    'COMMISSIONS_PAYMENT_PORTAL',
    'CORRESPONDENCE',
    'PIP_PENDING',
    'PENDING_GROSS_COMMISSIONS',
    'PAYABLE_GROSS_COMMISSIONS',
    'COMMISSIONS_OVERVIEW',
    'COMMISSIONS_POLICY_HISTORY',
    'AGENT_DASHBOARD',
  ],
  startLocalConnectorRun: mocks.mockStartRun,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { LocalConnectorSignatureError } from '@/lib/national-life/local-connector/device-signature'
import { POST } from './route'

const mockVerify = mocks.mockVerify
const mockStartRun = mocks.mockStartRun

function signedRequest() {
  return new Request('https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fyntra-connector-version': '0.1.18',
    },
    body: '{}',
  })
}

const REMOTE_ENV = [
  'NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED',
  'NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION',
  'NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES',
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
  mocks.pageDiscoveryEnabled.mockReturnValue(false)
  mocks.exportEnabled.mockReturnValue(false)
  for (const key of REMOTE_ENV) delete process.env[key]
})

describe('local connector runs route', () => {
  it('is unavailable by default', async () => {
    mocks.enabled.mockReturnValue(false)
    const response = await POST(signedRequest())

    expect(response.status).toBe(404)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns 401 only when the signature is rejected', async () => {
    mockVerify.mockRejectedValueOnce(new LocalConnectorSignatureError())
    const response = await POST(signedRequest())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'DEVICE_REQUEST_REJECTED' })
    // Sem o cabeçalho: um 401 comum não autoriza o dispositivo a se apagar. Ele
    // cobre relógio fora da janela da assinatura, que persiste depois de
    // reparear — apagar a chave por causa dele é um laço infinito.
    expect(response.headers.get('x-fyntra-device-error')).toBe('INVALID_DEVICE_SIGNATURE')
  })

  it('states revocation explicitly so the device may forget its key', async () => {
    mockVerify.mockRejectedValueOnce(new LocalConnectorSignatureError('DEVICE_REVOKED'))
    const response = await POST(signedRequest())

    expect(response.status).toBe(401)
    expect(response.headers.get('x-fyntra-device-error')).toBe('DEVICE_REVOKED')
  })

  it('does not report a server failure as a rejected device', async () => {
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await POST(signedRequest())
    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'RUN_START_FAILED' })
  })

  it('returns 400 for an oversized body without touching the signature check', async () => {
    const response = await POST(
      new Request(
        'https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': '999999',
            'x-fyntra-connector-version': '0.1.18',
          },
          body: '{}',
        },
      ),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('refuses a client below the floor with 426, before any work', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '0.2.0'
    const response = await POST(signedRequest())

    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({ error: 'CLIENT_TOO_OLD', minVersion: '0.2.0' })
    // Antes da assinatura: um cliente abaixo do piso não deve nem consumir o
    // registro de replay, e a recusa não depende de ele estar pareado.
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockStartRun).not.toHaveBeenCalled()
  })

  it('refuses a client that cannot execute the required commission-detail stage', async () => {
    const request = signedRequest()
    request.headers.set('x-fyntra-connector-version', '0.1.17')

    const response = await POST(request)

    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({ error: 'CLIENT_TOO_OLD', minVersion: '0.1.18' })
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockStartRun).not.toHaveBeenCalled()
  })

  it('lets a client at or above the floor through', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_MIN_VERSION = '0.2.0'
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({ runId: 'run_1', schemaVersion: 2, stages: [], duplicate: false, completedStages: 0 })
    const request = new Request(
      'https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fyntra-connector-version': '0.2.0' },
        body: '{}',
      },
    )
    expect((await POST(request)).status).toBe(201)
  })

  it('the kill switch stops runs without any extension update', async () => {
    // A alavanca de emergência é uma flag, não um release: latência de minutos
    // contra os dias que a Chrome Web Store impõe.
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_PAUSED = 'true'
    const response = await POST(signedRequest())

    expect(response.status).toBe(503)
    expect(response.headers.get('x-fyntra-connector-state')).toBe('PAUSED')
    expect(await response.json()).toEqual({ error: 'CONNECTOR_PAUSED' })
    expect(mockStartRun).not.toHaveBeenCalled()
  })

  it('disabling READ_GRID stops runs without pausing the whole connector', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES = 'READ_GRID'
    expect((await POST(signedRequest())).status).toBe(503)
  })

  it('requires READ_PAGE and sends only the selected priority plan when page reads are enabled', async () => {
    mocks.pageDiscoveryEnabled.mockReturnValue(true)
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({
      runId: 'run_1', schemaVersion: 2, stages: [], duplicate: false, completedStages: 0,
    })

    const response = await POST(signedRequest())

    expect(response.status).toBe(201)
    expect(mockStartRun).toHaveBeenCalledWith(
      {},
      { deviceId: 'dev_1', agentId: 'agent_1' },
      {
        gridKeys: [
          'NEW_BUSINESS',
          'RECENTLY_CLOSED',
          'INFORCE_CLIENTS',
          'PAID_COMMISSIONS',
          'COMMISSIONS_EARNING_REPORT',
          'COMMISSIONS_PAYMENT_PORTAL',
          'CORRESPONDENCE',
          'PIP_PENDING',
          'PENDING_GROSS_COMMISSIONS',
          'PAYABLE_GROSS_COMMISSIONS',
          'COMMISSIONS_OVERVIEW',
          'COMMISSIONS_POLICY_HISTORY',
          'AGENT_DASHBOARD',
        ],
      },
    )
  })

  it('does not require READ_PAGE while discovery is disabled', async () => {
    process.env.NATIONAL_LIFE_LOCAL_CONNECTOR_DISABLED_CAPABILITIES = 'READ_PAGE'
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({
      runId: 'run_1', schemaVersion: 2, stages: [], duplicate: false, completedStages: 0,
    })

    expect((await POST(signedRequest())).status).toBe(201)
    expect(mockStartRun).toHaveBeenCalledWith(
      {},
      { deviceId: 'dev_1', agentId: 'agent_1' },
      {
        gridKeys: [
          'NEW_BUSINESS',
          'RECENTLY_CLOSED',
          'INFORCE_CLIENTS',
          'PAID_COMMISSIONS',
          'COMMISSIONS_EARNING_REPORT',
          'COMMISSIONS_PAYMENT_PORTAL',
          'CORRESPONDENCE',
          'PIP_PENDING',
          'PAYABLE_GROSS_COMMISSIONS',
        ],
      },
    )
  })

  it('enables the official export for a priority-compatible extension', async () => {
    mocks.exportEnabled.mockReturnValue(true)
    mockVerify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mockStartRun.mockResolvedValue({ runId: 'run-export' })
    const request = signedRequest()
    request.headers.set('x-fyntra-connector-version', '0.1.18')

    expect((await POST(request)).status).toBe(201)
    expect(mockStartRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ exportEnabled: true }),
    )
  })

  it('does not fall back to a narrower plan for a client that cannot execute commission detail', async () => {
    mocks.exportEnabled.mockReturnValue(true)
    mockVerify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mockStartRun.mockResolvedValue({ runId: 'run-grid' })
    const request = signedRequest()
    request.headers.set('x-fyntra-connector-version', '0.1.14')

    const response = await POST(request)
    expect(response.status).toBe(426)
    expect(mockStartRun).not.toHaveBeenCalled()
  })

  it('forwards an explicit full-refresh request without changing the default', async () => {
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({
      runId: 'run_1', schemaVersion: 3, stages: [], duplicate: false, completedStages: 0,
    })
    const request = new Request(
      'https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fyntra-connector-version': '0.1.18',
        },
        body: JSON.stringify({ forceRefresh: true }),
      },
    )

    expect((await POST(request)).status).toBe(201)
    expect(mockStartRun).toHaveBeenCalledWith(
      {},
      { deviceId: 'dev_1', agentId: 'agent_1' },
      {
        forceRefresh: true,
        gridKeys: expect.any(Array),
      },
    )
  })

  it('starts a run when the signature and start succeed', async () => {
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({
      runId: 'run_1',
      schemaVersion: 1,
      stages: [],
      duplicate: false,
      completedStages: 0,
    })
    const response = await POST(signedRequest())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
