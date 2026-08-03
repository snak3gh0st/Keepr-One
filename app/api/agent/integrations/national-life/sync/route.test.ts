import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getNationalLifeEnv: vi.fn(),
  isConfigured: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/national-life/env', () => ({
  getNationalLifeEnv: mocks.getNationalLifeEnv,
  isNationalLifeConfigured: mocks.isConfigured,
}))
vi.mock('@/lib/national-life/sync-run-service', () => ({
  getNationalLifeSyncStatus: mocks.getStatus,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isConfigured.mockReturnValue(true)
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.getNationalLifeEnv.mockReturnValue({ sessionScopeId: 'scope-1' })
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

    expect(mocks.getStatus).toHaveBeenCalledWith('agent-1', 'scope-1')
    const body = await response.json()
    expect(body).toEqual({
      run: expect.objectContaining({ runId: 'run-1', completed: 3, total: 9, percent: 33 }),
    })
    expect(body.run.safeErrorCode).toBeUndefined()
  })

  it('returns no run when the integration is not configured', async () => {
    mocks.isConfigured.mockReturnValue(false)

    const response = await GET()

    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
    expect(mocks.getStatus).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ run: null })
  })

  it('fails closed when status lookup fails', async () => {
    mocks.getStatus.mockRejectedValue(new Error('db unreachable'))

    const response = await GET()

    await expect(response.json()).resolves.toEqual({ run: null })
  })
})
