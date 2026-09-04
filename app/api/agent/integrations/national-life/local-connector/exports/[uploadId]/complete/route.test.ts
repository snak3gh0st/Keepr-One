import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  verify: vi.fn(),
  complete: vi.fn(),
  ingest: vi.fn(),
  ingestDeps: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () => new Response(null, { status: 503 }),
}))
vi.mock('@/lib/national-life/local-connector/remote-config', () => ({
  refuseLocalConnectorCapability: () => null,
}))
vi.mock('@/lib/national-life/local-connector/device-signature', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/national-life/local-connector/device-signature')>()
  return { ...actual, verifyLocalConnectorDeviceRequest: mocks.verify }
})
vi.mock('@/lib/national-life/local-connector/export-upload-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/national-life/local-connector/export-upload-service')>()
  return { ...actual, completeNationalLifeExportUpload: mocks.complete }
})
vi.mock('@/lib/national-life/portfolio-ingest', () => ({
  ingestPortfolioIfRunFinished: mocks.ingest,
}))
vi.mock('@/lib/national-life/portfolio-ingest-prisma', () => ({
  prismaIngestDeps: mocks.ingestDeps,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  LocalConnectorSignatureError,
} from '@/lib/national-life/local-connector/device-signature'
import {
  NationalLifeExportUploadError,
} from '@/lib/national-life/local-connector/export-upload-service'
import { POST } from './route'

const url = 'https://app.keepr.one/api/agent/integrations/national-life/local-connector/exports/upload-1/complete'
const params = { uploadId: 'upload-1' }
const dependencies = { kind: 'portfolio-deps' }
const portfolio = { clientsCreated: 1, policiesUpserted: 2 }

function request(body: unknown = params) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function completedExport(overrides: Record<string, unknown> = {}) {
  return {
    uploadId: 'upload-1',
    runId: 'run-1',
    sourceKey: 'INFORCE_CLIENTS',
    rowCount: 2,
    writtenCount: 2,
    completed: true,
    duplicate: false,
    nextStageIndex: 2,
    terminal: true,
    ...overrides,
  }
}

describe('local connector National Life export completion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.complete.mockResolvedValue(completedExport())
    mocks.ingestDeps.mockReturnValue(dependencies)
    mocks.ingest.mockResolvedValue(portfolio)
  })

  it('finalizes the authenticated agent portfolio after a terminal export', async () => {
    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(201)
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-1',
    })
    expect(mocks.ingestDeps).toHaveBeenCalledWith(expect.anything())
    expect(mocks.ingest).toHaveBeenCalledWith(dependencies, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      terminal: true,
    })
    await expect(response.json()).resolves.toMatchObject({ portfolio })
  })

  it('revalidates the exact run before promoting a completed upload', async () => {
    mocks.complete.mockResolvedValue(completedExport({ terminal: false }))
    mocks.ingest.mockResolvedValue(null)

    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(201)
    expect(mocks.ingest).toHaveBeenCalledWith(dependencies, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      terminal: true,
    })
    await expect(response.json()).resolves.toMatchObject({ portfolio: null })
  })

  it('retries portfolio recovery on duplicate completion', async () => {
    mocks.complete.mockResolvedValue({
      uploadId: 'upload-1',
      runId: 'run-1',
      sourceKey: 'INFORCE_CLIENTS',
      rowCount: 2,
      writtenCount: 2,
      completed: true,
      duplicate: true,
    })
    mocks.ingest.mockResolvedValue(null)

    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(200)
    expect(mocks.ingest).toHaveBeenCalledWith(dependencies, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      terminal: true,
    })
    await expect(response.json()).resolves.toMatchObject({ duplicate: true, portfolio: null })
  })

  it('keeps a rejected device request separate from export completion', async () => {
    mocks.verify.mockRejectedValueOnce(new LocalConnectorSignatureError())

    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'DEVICE_REQUEST_REJECTED' })
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('keeps existing export completion failures intact', async () => {
    mocks.complete.mockRejectedValueOnce(new NationalLifeExportUploadError('EXPORT_INCOMPLETE'))

    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'EXPORT_INCOMPLETE' })
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
})
