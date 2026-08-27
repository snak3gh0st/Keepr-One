import 'server-only'

import { prisma } from '@/lib/prisma'

export class AgentOnboardingRequiredError extends Error {
  readonly code = 'AGENT_ONBOARDING_REQUIRED'

  constructor(readonly agentId: string) {
    super('Agent onboarding must be completed before accessing the platform')
    this.name = 'AgentOnboardingRequiredError'
  }
}

/**
 * The row is additive: legacy agents have no row and remain grandfathered.
 * Only an explicit IN_PROGRESS record closes the product boundary.
 */
export async function requireAgentOnboardingCompleteForUser(
  userId: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { userId },
    select: {
      id: true,
      onboarding: { select: { status: true } },
    },
  })
  if (agent?.onboarding?.status === 'IN_PROGRESS') {
    throw new AgentOnboardingRequiredError(agent.id)
  }
}
