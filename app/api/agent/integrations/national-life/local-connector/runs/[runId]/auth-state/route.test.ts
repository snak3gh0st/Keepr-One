import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  record: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () => Response.json({ error: 'NOT_FOUND' }, { status: 404 }),
}))
vi.mock('@/lib/national-life/local-connector/device-signature', () => ({
  LocalConnectorSignatureError: class extends Error {
    constructor(readonly code = 'INVALID_DEVICE_SIGNATURE') { super(code) }
  },
  verifyLocalConnectorDeviceRequest: mocks.verify,
}))
vi.mock('@/lib/national-life/local-connector/auth-notification-service', () => ({
  recordLocalConnectorAuthState: mocks.record,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from './route'

function request(body: unknown) {
  return new Request('http://localhost/api/agent/integrations/national-life/local-connector/runs/run-1/auth-state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('local connector auth-state route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.record.mockResolvedValue({ runId: 'run-1', authState: 'REQUIRED' })
  })

  it('accepts only a signed, bounded authentication state without credentials', async () => {
    const response = await POST(request({ state: 'REQUIRED' }), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      state: 'REQUIRED',
    })
  })

  it('rejects credential-shaped payloads instead of accepting extra fields', async () => {
    const response = await POST(request({ state: 'REQUIRED', password: 'must-not-land' }), {
      params: Promise.resolve({ runId: 'run-1' }),
    })

    expect(response.status).toBe(400)
    expect(mocks.record).not.toHaveBeenCalled()
  })
})
