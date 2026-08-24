import type { PrismaClient } from '@prisma/client'
import type { IngestDeps } from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'

export function prismaIngestDeps(prisma: PrismaClient): IngestDeps {
  return {
    loadInforceRows: async (agentId) =>
      (await prisma.nationalLifeInforcePolicy.findMany({
        where: { agentId },
        select: {
          deploymentScope: true,
          policyNumber: true,
          policyStatus: true,
          policyIssueDate: true,
          productName: true,
          insuredClientName: true,
          insuredDob: true,
          insuredEmail: true,
          insuredPhoneNumber: true,
          insuredZipcode: true,
          ownerClientName: true,
          anticipatedAnnualPremium: true,
        },
      })) as InforceRow[],

    loadClients: async (agentId) =>
      prisma.client.findMany({
        where: { assignedAgentId: agentId },
        select: { id: true, name: true, dateOfBirth: true },
      }),

    createClient: async ({ agentId, name, dateOfBirth, email, phone }) =>
      prisma.client.create({
        data: { assignedAgentId: agentId, name, dateOfBirth, email, phone },
        select: { id: true },
      }),

    upsertPolicy: async (input) => {
      const shared = {
        clientId: input.clientId,
        agentId: input.agentId,
        carrier: input.carrier,
        product: input.product,
        status: input.status,
        sourceStatus: input.sourceStatus,
        // Missing carrier money remains unknown. Zero is a business value and
        // must never be manufactured to satisfy storage constraints.
        premium: input.premium,
        effectiveDate: input.effectiveDate,
        sourceUpdatedAt: new Date(),
      }
      await prisma.policy.upsert({
        where: {
          sourceProvider_sourceExternalId: {
            sourceProvider: input.sourceProvider,
            sourceExternalId: input.sourceExternalId,
          },
        },
        // `faceAmount` is absent from `update` on purpose: the backfill owns that
        // column once it has a real number, and a later sync must not erase it.
        update: shared,
        create: {
          ...shared,
          policyNumber: input.policyNumber,
          sourceProvider: input.sourceProvider,
          sourceExternalId: input.sourceExternalId,
          faceAmount: input.faceAmount,
        },
      })
    },
  }
}
