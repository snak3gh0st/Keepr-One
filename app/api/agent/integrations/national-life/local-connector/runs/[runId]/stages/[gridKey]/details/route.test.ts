import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  verify: vi.fn(),
  listLinks: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () => Response.json(
    { error: 'NOT_AVAILABLE' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  ),
}))
vi.mock('@/lib/national-life/local-connector/remote-config', () => ({
  refuseLocalConnectorCapability: () => null,
}))
vi.mock('@/lib/national-life/local-connector/device-signature', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/national-life/local-connector/device-signature')
  >('@/lib/national-life/local-connector/device-signature')
  return { ...actual, verifyLocalConnectorDeviceRequest: mocks.verify }
})
vi.mock('@/lib/national-life/local-connector/commission-detail-service', () => ({
  listNationalLifeCommissionEarningLinks: mocks.listLinks,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { LocalConnectorSignatureError } from '@/lib/national-life/local-connector/device-signature'
import { POST } from './route'

const url =
  'https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs/run-1/stages/COMMISSIONS_EARNING_REPORT/details'
const params = { runId: 'run-1', gridKey: 'COMMISSIONS_EARNING_REPORT' }

function request(body: unknown = params) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('local connector commission detail discovery route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.listLinks.mockResolvedValue({
      parentRows: 2,
      links: [{ path: '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning?id=aaa1', statementId: 'aaa1' }],
    })
  })

  it('returns links from the signed current run', async () => {
    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ parentRows: 2, links: [{ statementId: 'aaa1' }] })
    expect(mocks.listLinks).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
    })
  })

  it('rejects a body or route that names another stage', async () => {
    const response = await POST(
      request({ runId: 'run-1', gridKey: 'PAID_COMMISSIONS' }),
      { params: Promise.resolve(params) },
    )

    expect(response.status).toBe(400)
    expect(mocks.listLinks).not.toHaveBeenCalled()
  })

  it('keeps signature rejection distinct from discovery failure', async () => {
    mocks.verify.mockRejectedValueOnce(new LocalConnectorSignatureError())
    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(401)
    expect(response.headers.get('x-fyntra-device-error')).toBe('INVALID_DEVICE_SIGNATURE')
    expect(mocks.listLinks).not.toHaveBeenCalled()
  })
})
