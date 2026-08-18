import type { PrismaClient } from '@prisma/client'
import { createChatwootClient } from './chatwoot-client'
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

    saveAccount: async ({ agentId, externalAccountId, externalUserId }) => {
      await prisma.agentMessagingAccount.create({
        data: { agentId, externalAccountId, externalUserId },
      })
    },

    chatwoot: createChatwootClient({
      baseUrl: config.baseUrl,
      platformToken: config.platformToken,
      http: (url, init) => fetch(url, init),
    }),

    // Long and random because nobody types it: the agent reaches the inbox by SSO.
    randomPassword: () =>
      [...crypto.getRandomValues(new Uint8Array(18))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
  }
}
