import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  localConfig: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/national-life/sync-run-service', () => ({
  getNationalLifeSyncStatus: mocks.getStatus,
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  getNationalLifeLocalConnectorConfig: mocks.localConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'LOCAL_CONNECTOR',
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.localConfig.mockReturnValue({
    enabled: true,
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    installMode: 'store',
    storeUrl: 'https://chromewebstore.google.com/detail/keepr/abcdefghijklmnopabcdefghijklmnop',
    baseUrl: 'https://app.keepr.one',
  })
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
})

describe('National Life sync status route', () => {
  it('returns only the current agent run and its safe progress', async () => {
    mocks.getStatus.mockResolvedValue({
      runId: 'run-1',
      state: 'RUNNING',
      completed: 3,
      total: 9,
      percent: 33,
      failed: 0,
      currentGridKey: 'CORRESPONDENCE',
      currentGridLabel: 'correspondências',
      safeErrorCode: null,
      shouldPoll: true,
      completedAt: null,
    })

    const response = await GET()

    expect(mocks.getStatus).toHaveBeenCalledWith('agent-1', 'LOCAL_CONNECTOR')
    const body = await response.json()
    expect(body).toEqual({
      engine: 'KEEPRONE_CONNECT',
      pipeline: [
        'KEEPRONE_SYNC',
        'KEEPRONE_CONNECT_REQUEST',
        'NATIONAL_LIFE_BROWSER',
        'KEEPRONE_CONNECT_RECEIPT',
        'KEEPRONE_VALIDATE_DEDUPLICATE',
        'KEEPRONE_DATABASE',
        'KEEPRONE_APP_RENDER',
      ],
      run: expect.objectContaining({ runId: 'run-1', completed: 3, total: 9, percent: 33 }),
    })
    expect(body.run.safeErrorCode).toBeUndefined()
  })

  it('returns no run when the integration is not configured', async () => {
    mocks.localConfig.mockReturnValue({ enabled: false })

    const response = await GET()

    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
    expect(mocks.getStatus).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      engine: 'KEEPRONE_CONNECT',
      run: null,
    })
  })

  it('reads only the canonical local connector run', async () => {
    mocks.getStatus.mockResolvedValue({ runId: 'local-run', safeErrorCode: null })

    const response = await GET()

    expect(mocks.getStatus).toHaveBeenCalledWith('agent-1', 'LOCAL_CONNECTOR')
    await expect(response.json()).resolves.toMatchObject({
      engine: 'KEEPRONE_CONNECT',
      run: { runId: 'local-run' },
    })
  })

  it('fails closed when status lookup fails', async () => {
    mocks.getStatus.mockRejectedValue(new Error('db unreachable'))

    const response = await GET()

    await expect(response.json()).resolves.toMatchObject({
      engine: 'KEEPRONE_CONNECT',
      run: null,
    })
  })
})
