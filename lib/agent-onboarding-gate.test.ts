import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findAgent: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { agent: { findUnique: mocks.findAgent } },
}))

import {
  AgentOnboardingRequiredError,
  requireAgentOnboardingCompleteForUser,
} from './agent-onboarding-gate'

describe('agent onboarding product gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('grandfathers a legacy agent whose onboarding row is absent', async () => {
    mocks.findAgent.mockResolvedValue({ id: 'legacy-agent', onboarding: null })
    await expect(requireAgentOnboardingCompleteForUser('legacy-user')).resolves.toBeUndefined()
  })

  it('blocks only an explicit in-progress onboarding', async () => {
    mocks.findAgent.mockResolvedValue({
      id: 'new-agent',
      onboarding: { status: 'IN_PROGRESS' },
    })
    await expect(requireAgentOnboardingCompleteForUser('new-user')).rejects.toEqual(
      expect.objectContaining({
        name: 'AgentOnboardingRequiredError',
        code: 'AGENT_ONBOARDING_REQUIRED',
        agentId: 'new-agent',
      }),
    )
  })

  it('allows a completed onboarding', async () => {
    mocks.findAgent.mockResolvedValue({
      id: 'new-agent',
      onboarding: { status: 'COMPLETED' },
    })
    await expect(requireAgentOnboardingCompleteForUser('new-user')).resolves.toBeUndefined()
    expect(new AgentOnboardingRequiredError('agent-1')).toBeInstanceOf(Error)
  })
})
