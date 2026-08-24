import type { PrismaClient } from '@prisma/client'
import { createChatwootClient } from './chatwoot-client'
import { randomChatwootPassword } from './random-password'
import type { ProvisionDeps } from './provision-agent-inbox'

export function prismaProvisionDeps(
  prisma: PrismaClient,
  config: { baseUrl: string; platformToken: string },
): ProvisionDeps {
  return {
    findAccount: async (agentId) =>
      prisma.agentMessagingAccount.findUnique({
        where: { agentId },
        select: { externalAccountId: true, externalUserId: true },
      }),

    saveAccount: async ({ agentId, externalAccountId, externalUserId, externalUserToken }) => {
      await prisma.agentMessagingAccount.create({
        data: { agentId, externalAccountId, externalUserId, externalUserToken },
      })
    },

    chatwoot: createChatwootClient({
      baseUrl: config.baseUrl,
      platformToken: config.platformToken,
      http: (url, init) => fetch(url, init),
    }),

    randomPassword: randomChatwootPassword,
  }
}
