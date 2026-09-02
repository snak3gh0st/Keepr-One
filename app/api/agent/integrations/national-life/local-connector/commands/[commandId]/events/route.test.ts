import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  record: vi.fn(),
  retireNotifications: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'national-life-local-connector',
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
  return { ...actual, recordDeviceConnectorCommandEvent: mocks.record }
})
vi.mock('@/lib/national-life/local-connector/command-dispatch-prisma', () => ({
  prismaLocalConnectorCommandDispatchRepository: {},
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    illustration: { findFirst: vi.fn() },
    notification: { updateMany: mocks.retireNotifications },
  },
}))
vi.mock('@/lib/national-life/policy-detail-prisma', () => ({
  createPrismaPolicyDetailRepository: () => ({ kind: 'policy-detail-repository' }),
}))
vi.mock('@/lib/national-life/promotion-credit-sync', () => ({
  syncPolicyDetailPromotionCreditsSafely: vi.fn(),
}))

import { ConnectorCommandError } from '@/lib/national-life/connector-command-service'
import { POST } from './route'

const commandId = 'cmd_1'
const url = `https://app.keeprone.com/api/agent/integrations/national-life/local-connector/commands/${commandId}/events`
const event = {
  protocolVersion: 1,
  eventId: 'event_1',
  commandId,
  runId: 'run_1',
  sequence: 1,
  type: 'COMMAND_STARTED',
  emittedAt: '2026-08-26T17:00:00.000Z',
  payload: null,
  error: null,
}

function request(body: unknown = event) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('local connector command event route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent_1', deviceId: 'device_1' })
    mocks.record.mockResolvedValue(undefined)
    mocks.retireNotifications.mockResolvedValue({ count: 1 })
  })

  it('records an event under the exact signed device and path command', async () => {
    const response = await POST(request(), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent_1',
      deviceId: 'device_1',
      commandId,
      event,
      now: expect.any(Date),
      policyDetailRepository: { kind: 'policy-detail-repository' },
      syncPolicyDetailPromotionCreditsSafely: expect.any(Function),
      foresightArtifactRepository: expect.objectContaining({
        findOwnedArtifact: expect.any(Function),
        persistTermResult: expect.any(Function),
      }),
      extractTermPremiums: expect.any(Function),
      flexLifeQuoteRepository: expect.objectContaining({ persistOwnedQuoteResult: expect.any(Function) }),
      applicationDraftReceiptRepository: expect.objectContaining({ persistOwnedDraftReceipt: expect.any(Function) }),
      deploymentScope: 'national-life-local-connector',
    })
    expect(mocks.retireNotifications).toHaveBeenCalledWith({
      where: {
        type: 'NATIONAL_LIFE_MFA_REQUIRED',
        readAt: null,
        dedupeKey: {
          startsWith: 'national-life-mfa-required:CONNECTOR_COMMAND:cmd_1:',
        },
      },
      data: { readAt: expect.any(Date) },
    })
  })

  it('keeps an accepted command event successful if notification cleanup fails', async () => {
    mocks.retireNotifications.mockRejectedValueOnce(new Error('notification database unavailable'))

    const response = await POST(request(), { params: Promise.resolve({ commandId }) })

    expect(response.status).toBe(204)
    expect(mocks.record).toHaveBeenCalledOnce()
  })

  it('rejects a body naming a different command', async () => {
    const response = await POST(request({ ...event, commandId: 'cmd_2' }), {
      params: Promise.resolve({ commandId }),
    })
    expect(response.status).toBe(400)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('does not reveal a command owned by another device', async () => {
    mocks.record.mockRejectedValueOnce(new ConnectorCommandError('COMMAND_NOT_FOUND'))
    const response = await POST(request(), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'COMMAND_NOT_FOUND' })
  })

  it('returns a safe, specific Term reconciliation cause to the paired extension', async () => {
    mocks.record.mockRejectedValueOnce(new ConnectorCommandError('FORESIGHT_TERM_PREMIUM_MISSING'))

    const response = await POST(request(), { params: Promise.resolve({ commandId }) })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'FORESIGHT_TERM_PREMIUM_MISSING' })
  })
})
