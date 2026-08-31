import { Prisma, type PrismaClient } from '@prisma/client'
import { createChatwootClient } from './chatwoot-client'
import { randomChatwootPassword } from './random-password'
import type {
  ProvisionDeps,
  ProvisionOperationDeps,
} from './provision-agent-inbox'

type ProvisionPrisma = Pick<PrismaClient, 'agentMessagingAccount'>

function prismaProvisionOperationDeps(
  prisma: ProvisionPrisma,
  config: { baseUrl: string; platformToken: string },
): ProvisionOperationDeps {
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

export function prismaProvisionDeps(
  prisma: PrismaClient,
  config: { baseUrl: string; platformToken: string },
): ProvisionDeps {
  return {
    ...prismaProvisionOperationDeps(prisma, config),
    runExclusive: async (agentId, operation) => prisma.$transaction(
      async (transaction) => {
        // The transaction-scoped advisory lock serializes first-connect POSTs
        // for this agent across server instances. Once the first request commits,
        // the next request sees and reuses its unique local account link.
        await transaction.$queryRaw(
          Prisma.sql`SELECT 1 AS lock_acquired FROM pg_advisory_xact_lock(hashtextextended(${`keepr-agent-inbox:${agentId}`}, 0))`,
        )
        return operation(prismaProvisionOperationDeps(transaction, config))
      },
      { maxWait: 10_000, timeout: 60_000 },
    ),
  }
}
