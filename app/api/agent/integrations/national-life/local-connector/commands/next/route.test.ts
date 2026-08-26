import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  claim: vi.fn(),
  refuse: vi.fn(() => null),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () => Response.json({ error: 'NOT_AVAILABLE' }, { status: 404 }),
}))
vi.mock('@/lib/national-life/local-connector/device-signature', async () => {
  const actual = await vi.importActual<typeof import('@/lib/national-life/local-connector/device-signature')>(
    '@/lib/national-life/local-connector/device-signature',
  )
  return { ...actual, verifyLocalConnectorDeviceRequest: mocks.verify }
})
vi.mock('@/lib/national-life/local-connector/command-dispatch-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/national-life/local-connector/command-dispatch-service')>(
    '@/lib/national-life/local-connector/command-dispatch-service',
  )
  return { ...actual, claimNextConnectorCommand: mocks.claim }
})
vi.mock('@/lib/national-life/local-connector/command-dispatch-prisma', () => ({
  prismaLocalConnectorCommandDispatchRepository: {},
}))
vi.mock('@/lib/national-life/local-connector/remote-config', () => ({
  refuseLocalConnectorCapability: mocks.refuse,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { LocalConnectorSignatureError } from '@/lib/national-life/local-connector/device-signature'
import { POST } from './route'

const url = 'https://app.keeprone.com/api/agent/integrations/national-life/local-connector/commands/next'
const command = {
  protocolVersion: 1,
  commandId: 'cmd_1',
  runId: 'run_1',
  capability: 'READ_POLICY_DETAIL',
  target: { kind: 'POLICY', id: 'policy_1' },
  params: {
    policyNumber: 'LS1473219',
    navigatePath: '/agent/book-of-business/inforce-book/all-clients/policy-details?id=a73f1af893a94906b965e68d11db807b',
  },
  idempotencyKey: 'policy_1:detail:1',
  issuedAt: '2026-08-26T17:00:00.000Z',
  expiresAt: '2026-08-26T17:10:00.000Z',
  requiresConfirmation: false,
}

function request(body = '{}') {
  return new Request(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

describe('local connector next command route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent_1', deviceId: 'device_1' })
    mocks.claim.mockResolvedValue({
      command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
    })
    mocks.refuse.mockReturnValue(null)
  })

  it('returns only the next command scoped by the signed device identity', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      command, state: 'QUEUED', nextEventSequence: 1, lastEventType: 'COMMAND_ACCEPTED',
    })
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent_1', deviceId: 'device_1', now: expect.any(Date),
    })
    expect(mocks.refuse).toHaveBeenCalledWith('READ_POLICY_DETAIL', expect.any(Headers))
  })

  it('returns 204 when this device has no eligible command', async () => {
    mocks.claim.mockResolvedValueOnce(null)
    const response = await POST(request())
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('never polls after signature rejection', async () => {
    mocks.verify.mockRejectedValueOnce(new LocalConnectorSignatureError())
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(mocks.claim).not.toHaveBeenCalled()
  })
})
