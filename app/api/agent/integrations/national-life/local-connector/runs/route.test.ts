import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  mockVerify: vi.fn(),
  mockStartRun: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
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
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(true)
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
          headers: { 'content-type': 'application/json', 'content-length': '999999' },
          body: '{}',
        },
      ),
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('starts a run when the signature and start succeed', async () => {
    mockVerify.mockResolvedValueOnce({ deviceId: 'dev_1', agentId: 'agent_1' })
    mockStartRun.mockResolvedValueOnce({
      runId: 'run_1',
      schemaVersion: 1,
      stages: [],
      duplicate: false,
    })
    const response = await POST(signedRequest())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
