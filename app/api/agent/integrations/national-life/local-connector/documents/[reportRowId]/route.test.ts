import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  verify: vi.fn(),
  requestTransfer: vi.fn(),
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
vi.mock('@/lib/national-life/local-connector/document-transfer-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/national-life/local-connector/document-transfer-service')
  >('@/lib/national-life/local-connector/document-transfer-service')
  return { ...actual, requestNationalLifeDocumentTransfer: mocks.requestTransfer }
})
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { LocalConnectorSignatureError } from '@/lib/national-life/local-connector/device-signature'
import { NationalLifeDocumentTransferError } from '@/lib/national-life/local-connector/document-transfer-service'
import { POST } from './route'

const reportRowId = 'report-row-1'
const url = `https://app.keeprone.com/api/agent/integrations/national-life/local-connector/documents/${reportRowId}`

function request(body: unknown = { reportRowId }) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('National Life document request route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.requestTransfer.mockResolvedValue({
      completed: false,
      transferId: 'transfer-1',
      encryptedHandle: 'ZW5jcnlwdGVkLWNhcnJpZXItaGFuZGxlLTEyMw==',
      fileName: 'document.pdf',
    })
  })

  it('passes the signed agent and device scope into the transfer service', async () => {
    const response = await POST(request(), { params: Promise.resolve({ reportRowId }) })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.requestTransfer).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      reportRowId,
    })
  })

  it('refuses a body that names a different source row', async () => {
    const response = await POST(
      request({ reportRowId: 'another-row' }),
      { params: Promise.resolve({ reportRowId }) },
    )

    expect(response.status).toBe(400)
    expect(mocks.requestTransfer).not.toHaveBeenCalled()
  })

  it('keeps a competing live transfer distinguishable from a bad request', async () => {
    mocks.requestTransfer.mockRejectedValueOnce(
      new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_CONFLICT'),
    )

    const response = await POST(request(), { params: Promise.resolve({ reportRowId }) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'DOCUMENT_TRANSFER_CONFLICT' })
  })

  it('does not run the service after signature rejection', async () => {
    mocks.verify.mockRejectedValueOnce(new LocalConnectorSignatureError())

    const response = await POST(request(), { params: Promise.resolve({ reportRowId }) })

    expect(response.status).toBe(401)
    expect(response.headers.get('x-fyntra-device-error')).toBe('INVALID_DEVICE_SIGNATURE')
    expect(mocks.requestTransfer).not.toHaveBeenCalled()
  })
})
