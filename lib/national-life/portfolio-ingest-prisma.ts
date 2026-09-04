import type { PrismaClient } from '@prisma/client'
import type { IngestDeps } from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'

export function prismaIngestDeps(prisma: PrismaClient): IngestDeps {
  return {
    loadInforceRows: async (agentId) => {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { status: true },
      })
      if (!agent || agent.status !== 'ACTIVE') return []

      return (await prisma.nationalLifeInforcePolicy.findMany({
        where: {
          agentId,
          // The paired connector owns this agent/scope partition. Carrier
          // AgentNumber is source data and cannot narrow the account's book.
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        },
        select: {
          deploymentScope: true,
          agentNumber: true,
          policyNumber: true,
          policyStatus: true,
          lastStatusChangeDate: true,
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
      })) as InforceRow[]
    },

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
      const mutable = {
        clientId: input.clientId,
        carrier: input.carrier,
        product: input.product,
        status: input.status,
        sourceStatus: input.sourceStatus,
        statusChangedAt: input.statusChangedAt,
        // Missing carrier money remains unknown. Zero is a business value and
        // must never be manufactured to satisfy storage constraints.
        premium: input.premium,
        // `input.premium` is AnticipatedAnnualPremium from the in-force book,
        // not a modal payment. Clear any frequency retained by an older/manual
        // Policy row so no reader can multiply the carrier's AAP again.
        premiumMode: null,
        effectiveDate: input.effectiveDate,
        sourceUpdatedAt: new Date(),
      }
      const ownershipKey = {
        sourceProvider: input.sourceProvider,
        sourceExternalId: input.sourceExternalId,
      }
      const ownedWhere = { ...ownershipKey, agentId: input.agentId }

      // Updating only a row already owned by this agent makes ownership part of
      // the write predicate. A read-then-upsert sequence is racy: two connector
      // runs can both observe absence and the losing ON CONFLICT branch can
      // reassign another tenant's policy.
      const updated = await prisma.policy.updateMany({
        where: ownedWhere,
        // `faceAmount` is absent on purpose: the backfill owns that column once
        // it has a real number, and a later sync must not erase it.
        data: mutable,
      })
      if (updated.count > 0) return

      try {
        await prisma.policy.create({
          data: {
            ...mutable,
            agentId: input.agentId,
            policyNumber: input.policyNumber,
            sourceProvider: input.sourceProvider,
            sourceExternalId: input.sourceExternalId,
            faceAmount: input.faceAmount,
          },
        })
        return
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : ''
        if (code !== 'P2002') throw error
      }

      // A concurrent same-owner create is safe to update; a zero count here
      // proves the global carrier key belongs to a different agent and fails
      // closed without touching their row.
      const raced = await prisma.policy.updateMany({
        where: ownedWhere,
        data: mutable,
      })
      if (raced.count === 0) throw new Error('POLICY_OWNERSHIP_CONFLICT')
    },
  }
}
