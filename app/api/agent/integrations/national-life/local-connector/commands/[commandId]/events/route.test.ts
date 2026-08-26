import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  record: vi.fn(),
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
  return { ...actual, recordDeviceConnectorCommandEvent: mocks.record }
})
vi.mock('@/lib/national-life/local-connector/command-dispatch-prisma', () => ({
  prismaLocalConnectorCommandDispatchRepository: {},
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

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
    })
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
})
