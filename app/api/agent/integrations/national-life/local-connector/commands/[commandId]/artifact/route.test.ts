import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  verify: vi.fn(),
  read: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
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
vi.mock('@/lib/prisma', () => ({
  prisma: { illustration: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}))

import { PUT } from './route'

const commandId = 'cmd_1'
const url = `https://app.keeprone.com/api/agent/integrations/national-life/local-connector/commands/${commandId}/artifact`
const pdf = new TextEncoder().encode('%PDF-1.7\nsynthetic-test-document')

function request(bytes = pdf, contentType = 'application/pdf') {
  return new Request(url, { method: 'PUT', body: bytes, headers: { 'content-type': contentType } })
}

describe('local connector illustration artifact route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent_1', deviceId: 'device_1' })
    mocks.read.mockResolvedValue({
      inputHash: 'a'.repeat(64),
      snapshot: { illustrationId: 'ill_1', carrierCaseName: 'KEEPRONE-20260826-ILL1' },
    })
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })

  it('stores only a signed PDF under the exact approved illustration command', async () => {
    const response = await PUT(request(), { params: Promise.resolve({ commandId }) })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      documentSha256: createHash('sha256').update(pdf).digest('hex'),
      documentBytes: pdf.byteLength,
    })
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      method: 'PUT', body: pdf,
    }))
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      agentId: 'agent_1', deviceId: 'device_1', commandId, now: expect.any(Date),
    })
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ill_1', agentId: 'agent_1' },
      data: expect.objectContaining({
        provider: 'NATIONAL_LIFE_FORESIGHT',
        externalId: 'agent_1:KEEPRONE-20260826-ILL1',
        documentBytes: Buffer.from(pdf),
        documentMimeType: 'application/pdf',
      }),
    }))
  })

  it('rejects non-PDF bytes after authenticating the device', async () => {
    const response = await PUT(request(new TextEncoder().encode('not a pdf')), {
      params: Promise.resolve({ commandId }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_PDF' })
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
