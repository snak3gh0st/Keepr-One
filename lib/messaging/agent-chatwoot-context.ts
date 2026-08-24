import { prisma } from '@/lib/prisma'
import { chatwootConfigFromEnv } from './chatwoot-config'
import { createChatwootAccountClient } from './chatwoot-account-client'

export class AgentMessagingUnavailableError extends Error {
  constructor(readonly code: 'CHATWOOT_UNAVAILABLE' | 'CHATWOOT_ACCOUNT_NOT_READY') {
    super(code)
    this.name = 'AgentMessagingUnavailableError'
  }
}

export async function getAgentChatwootContext(agentId: string) {
  const config = chatwootConfigFromEnv(process.env)
  if (!config) throw new AgentMessagingUnavailableError('CHATWOOT_UNAVAILABLE')

  const account = await prisma.agentMessagingAccount.findUnique({
    where: { agentId },
    select: { externalAccountId: true, externalUserToken: true },
  })
  if (!account?.externalUserToken) {
    throw new AgentMessagingUnavailableError('CHATWOOT_ACCOUNT_NOT_READY')
  }

  return {
    accountId: account.externalAccountId,
    token: account.externalUserToken,
    chatwoot: createChatwootAccountClient({
      baseUrl: config.baseUrl,
      http: (url, init) => fetch(url, init),
    }),
  }
}
