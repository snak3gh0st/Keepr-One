import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  count: vi.fn(),
  isConfigured: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/prisma', () => ({
  prisma: { browserAutomationJob: { count: mocks.count } },
}))
vi.mock('@/lib/national-life/env', () => ({ isNationalLifeConfigured: mocks.isConfigured }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isConfigured.mockReturnValue(true)
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
})

describe('carrier sync badge route', () => {
  it('counts working jobs across QUEUED, RUNNING and RETRYABLE, and blocked jobs only where a carrier login would revive them', async () => {
    mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0)

    const response = await GET()

    expect(mocks.count).toHaveBeenNthCalledWith(1, {
      where: {
        agentId: 'agent-1',
        provider: NATIONAL_LIFE_PROVIDER,
        state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
      },
    })
    // Must mirror releaseJobsBlockedOnCarrierLogin's filter exactly: plain
    // ACTION_REQUIRED also matches NATIONAL_LIFE_RECONNECT_REQUIRED parks,
    // which nothing ever drains back to QUEUED. Counting those would tell the
    // agent that connecting clears the badge, and it would not — this test
    // exists so the two filters can't silently drift apart again.
    expect(mocks.count).toHaveBeenNthCalledWith(2, {
      where: {
        agentId: 'agent-1',
        provider: NATIONAL_LIFE_PROVIDER,
        state: 'ACTION_REQUIRED',
        safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: { kind: 'WORKING', count: 2 },
    })
  })

  it('reports NEEDS_YOU only from the FORESIGHT_SSO_EXPIRED-scoped count', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'NEEDS_YOU', count: 1 },
    })
  })

  it('renders no badge when the integration is not configured', async () => {
    mocks.isConfigured.mockReturnValue(false)

    const response = await GET()

    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
    expect(mocks.count).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ state: null })
  })

  it('renders no badge rather than guess when the agent lookup fails', async () => {
    mocks.getCurrentAgent.mockRejectedValue(new Error('no session'))

    const response = await GET()

    await expect(response.json()).resolves.toEqual({ state: null })
  })

  it('renders no badge rather than guess when the queue query fails', async () => {
    mocks.count.mockRejectedValue(new Error('db unreachable'))

    const response = await GET()

    await expect(response.json()).resolves.toEqual({ state: null })
  })
})
