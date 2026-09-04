import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  verify: vi.fn(),
  complete: vi.fn(),
  canRead: vi.fn(),
  ingest: vi.fn(),
  ingestDeps: vi.fn(),
  syncCredits: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'LOCAL_CONNECTOR',
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
vi.mock('@/lib/national-life/local-connector/run-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/national-life/local-connector/run-service')>()
  return { ...actual, completeLocalConnectorStage: mocks.complete }
})
vi.mock('@/lib/national-life/plan-access', () => ({
  canAgentReadNationalLifeGrid: mocks.canRead,
}))
vi.mock('@/lib/national-life/portfolio-ingest', () => ({
  ingestPortfolioIfRunFinished: mocks.ingest,
}))
vi.mock('@/lib/national-life/portfolio-ingest-prisma', () => ({
  prismaIngestDeps: mocks.ingestDeps,
}))
vi.mock('@/lib/national-life/promotion-credit-sync', () => ({
  syncStoredNationalLifePromotionCreditsForAgentSafely: mocks.syncCredits,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from './route'

const url = 'https://app.keepr.one/api/agent/integrations/national-life/local-connector/runs/run-1/stages/INFORCE_CLIENTS/complete'
const params = { runId: 'run-1', gridKey: 'INFORCE_CLIENTS' }
const dependencies = { kind: 'portfolio-deps' }

function request(body: unknown = {
  runId: 'run-1', gridKey: 'INFORCE_CLIENTS', expectedRecordCount: 2, finalSequence: 0, truncated: false,
}) {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

describe('local connector National Life stage completion route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.verify.mockResolvedValue({ agentId: 'agent-1', deviceId: 'device-1' })
    mocks.canRead.mockResolvedValue(true)
    mocks.complete.mockResolvedValue({
      runId: 'run-1', gridKey: 'INFORCE_CLIENTS', receivedRecordCount: 2,
      completedStages: 2, failedStages: 0, nextStageIndex: 2, terminal: true, completed: true,
    })
    mocks.ingestDeps.mockReturnValue(dependencies)
    mocks.ingest.mockResolvedValue({ clientsCreated: 1, policiesUpserted: 2 })
    mocks.syncCredits.mockResolvedValue({ generated: 0 })
  })

  it('promotes only the exact signed terminal run', async () => {
    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(201)
    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', gridKey: 'INFORCE_CLIENTS',
    }))
    expect(mocks.ingest).toHaveBeenCalledWith(dependencies, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', terminal: true,
    })
  })

  it('does not promote a non-terminal stage', async () => {
    mocks.complete.mockResolvedValueOnce({
      runId: 'run-1', gridKey: 'INFORCE_CLIENTS', receivedRecordCount: 2,
      completedStages: 1, failedStages: 0, nextStageIndex: 1, terminal: false, completed: false,
    })
    mocks.ingest.mockResolvedValue(null)

    const response = await POST(request(), { params: Promise.resolve(params) })

    expect(response.status).toBe(201)
    expect(mocks.ingest).toHaveBeenCalledWith(dependencies, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', terminal: false,
    })
  })
})
