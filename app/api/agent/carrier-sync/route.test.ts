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
    // Must mirror releaseJobsBlockedOnCarrierLogin's filter exactly: both
    // ACTION_REQUIRED codes are parks that a fresh carrier login revives.
    // Keeping the count aligned with the drain prevents the badge from going
    // quiet while a job is still waiting, or from inviting a login that cannot
    // clear the state it reports.
    expect(mocks.count).toHaveBeenNthCalledWith(2, {
      where: {
        agentId: 'agent-1',
        provider: NATIONAL_LIFE_PROVIDER,
        state: 'ACTION_REQUIRED',
        safeErrorCode: {
          in: ['FORESIGHT_SSO_EXPIRED', 'NATIONAL_LIFE_RECONNECT_REQUIRED'],
        },
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: { kind: 'WORKING', count: 2 },
    })
  })

  it('reports NEEDS_YOU from the login-required count', async () => {
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
