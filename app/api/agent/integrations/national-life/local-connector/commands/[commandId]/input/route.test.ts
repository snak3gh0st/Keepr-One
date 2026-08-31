import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  read: vi.fn(),
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
  return { ...actual, readDeviceConnectorCommandInput: mocks.read }
})
vi.mock('@/lib/national-life/local-connector/command-dispatch-prisma', () => ({
  prismaLocalConnectorCommandDispatchRepository: {},
}))
vi.mock('@/lib/prisma', () => ({ prisma: { illustration: { findFirst: vi.fn() } } }))

import { ConnectorCommandError } from '@/lib/national-life/connector-command-service'
import { POST } from './route'

const commandId = 'cmd_1'
const url = `https://app.keeprone.com/api/agent/integrations/national-life/local-connector/commands/${commandId}/input`

function request(body = '{}') {
  return new Request(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

describe('local connector illustration command input route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent_1', deviceId: 'device_1' })
    mocks.read.mockResolvedValue({ inputHash: 'a'.repeat(64), snapshot: { schemaVersion: 1 } })
  })

  it('returns the sealed snapshot under the exact signed command and device', async () => {
    const response = await POST(request(), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      inputHash: 'a'.repeat(64), snapshot: { schemaVersion: 1 },
    })
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      agentId: 'agent_1', deviceId: 'device_1', commandId, now: expect.any(Date),
    })
  })

  it('does not reveal a command assigned to another device', async () => {
    mocks.read.mockRejectedValueOnce(new ConnectorCommandError('COMMAND_NOT_FOUND'))
    const response = await POST(request(), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'COMMAND_NOT_FOUND' })
  })

  it('rejects open-ended request bodies before reading input', async () => {
    const response = await POST(request('{"extra":true}'), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
