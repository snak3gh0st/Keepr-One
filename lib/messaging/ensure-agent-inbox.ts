import 'server-only'

import { prisma } from '@/lib/prisma'
import { chatwootConfigFromEnv } from './chatwoot-config'
import { provisionAgentInbox } from './provision-agent-inbox'
import { prismaProvisionDeps } from './provision-prisma'

/**
 * Provisions the agent's private Chatwoot account only after an authenticated
 * connect/setup POST. Retries reuse the unique local account link.
 */
export async function ensureAgentInbox(input: {
  agentId: string
  userId: string
}) {
  const config = chatwootConfigFromEnv(process.env)
  if (!config) throw new Error('CHATWOOT_UNAVAILABLE')

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true },
  })
  if (!user) throw new Error('AGENT_USER_NOT_FOUND')

  return provisionAgentInbox(prismaProvisionDeps(prisma, config), {
    agentId: input.agentId,
    agentName: user.name.trim() || 'Agente',
    agentEmail: user.email,
  })
}
