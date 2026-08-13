import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  failStage: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: () => true,
  localConnectorUnavailableResponse: () => new Response(null, { status: 503 }),
}))
vi.mock('@/lib/national-life/local-connector/device-signature', () => ({
  LocalConnectorSignatureError: class extends Error { constructor(readonly code: string) { super(code) } },
  verifyLocalConnectorDeviceRequest: mocks.verify,
}))
vi.mock('@/lib/national-life/local-connector/run-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/national-life/local-connector/run-service')>()
  return { ...actual, failLocalConnectorStage: mocks.failStage }
})
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from './route'

const url = 'http://localhost/api/agent/integrations/national-life/local-connector/runs/run-1/stages/PROJECTED_COMMISSIONS/fail'

describe('local connector isolated stage failure route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.failStage.mockResolvedValue({
      runId: 'run-1',
      gridKey: 'PROJECTED_COMMISSIONS',
      nextStageIndex: 5,
      terminal: false,
      state: 'RUNNING',
    })
  })

  it('records a signed source failure without failing the whole run', async () => {
    const response = await POST(new Request(url, {
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-1',
        gridKey: 'PROJECTED_COMMISSIONS',
        code: 'TEMPLATE_UNAVAILABLE',
        retryable: true,
      }),
    }), { params: Promise.resolve({ runId: 'run-1', gridKey: 'PROJECTED_COMMISSIONS' }) })

    expect(response.status).toBe(200)
    expect(mocks.failStage).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      gridKey: 'PROJECTED_COMMISSIONS',
      safeErrorCode: 'TEMPLATE_UNAVAILABLE',
      retryable: true,
    })
    await expect(response.json()).resolves.toMatchObject({ state: 'RUNNING', nextStageIndex: 5 })
  })

  it('rejects a body that names a different source from the signed route', async () => {
    const response = await POST(new Request(url, {
      method: 'POST',
      body: JSON.stringify({
        runId: 'run-1',
        gridKey: 'INFORCE_CLIENTS',
        code: 'TEMPLATE_UNAVAILABLE',
        retryable: true,
      }),
    }), { params: Promise.resolve({ runId: 'run-1', gridKey: 'PROJECTED_COMMISSIONS' }) })

    expect(response.status).toBe(400)
    expect(mocks.failStage).not.toHaveBeenCalled()
  })
})
