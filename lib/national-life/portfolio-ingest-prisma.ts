import type { PrismaClient } from '@prisma/client'
import type { IngestDeps } from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import { verifyPortfolioPages } from './current-portfolio'
import { toInforcePolicySnapshot } from './inforce-policy-mapper'
import type { GridRow } from './portal-grid-client'

export function prismaIngestDeps(prisma: PrismaClient): IngestDeps {
  return {
    loadInforceRows: async (input) => {
      const agent = await prisma.agent.findUnique({
        where: { id: input.agentId },
        select: { status: true },
      })
      if (!agent || agent.status !== 'ACTIVE') return null

      const completion = await prisma.nationalLifeConnectorStageCompletion.findFirst({
        where: {
          deviceId: input.deviceId,
          runId: input.runId,
          gridKey: 'INFORCE_CLIENTS',
          truncated: false,
          run: {
            id: input.runId,
            agentId: input.agentId,
            connectorDeviceId: input.deviceId,
            deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
            executionSource: 'LOCAL',
            provider: NATIONAL_LIFE_PROVIDER,
            state: { in: ['COMPLETED', 'PARTIAL'] },
          },
        },
        select: {
          completedAt: true,
          expectedRecordCount: true,
          receivedRecordCount: true,
          finalSequence: true,
          truncated: true,
          run: {
            select: {
              rawGridPages: {
                where: {
                  agentId: input.agentId,
                  deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
                  runId: input.runId,
                  gridKey: 'INFORCE_CLIENTS',
                },
                select: { sequence: true, recordCount: true, records: true, observedAt: true },
              },
            },
          },
        },
      })
      if (!completion) return null

      try {
        const pages = verifyPortfolioPages({ ...completion, pages: completion.run.rawGridPages })
        // The paired account is the ownership boundary. Carrier AgentNumber is
        // just source data: a legitimate paired account may return a different
        // or blank producer number, so never filter on it here.
        return pages.flatMap((page) => (page.records as GridRow[]).flatMap((raw) => {
          const row = toInforcePolicySnapshot(raw)
          if (!row) return []
          return [{
            sourceObservedAt: completion.completedAt,
            deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
            agentNumber: row.agentNumber,
            policyNumber: row.policyNumber,
            policyStatus: row.policyStatus,
            lastStatusChangeDate: row.lastStatusChangeDate,
            policyIssueDate: row.policyIssueDate,
            productName: row.productName,
            insuredClientName: row.insuredClientName,
            insuredDob: row.insuredDob,
            insuredEmail: row.insuredEmail,
            insuredPhoneNumber: row.insuredPhoneNumber,
            insuredZipcode: row.insuredZipcode,
            ownerClientName: row.ownerClientName,
            anticipatedAnnualPremium: row.anticipatedAnnualPremium,
          } satisfies InforceRow & { sourceObservedAt: Date }]
        }))
      } catch {
        return null
      }
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
        sourceUpdatedAt: input.sourceObservedAt ?? new Date(),
      }
      const ownershipKey = {
        sourceProvider: input.sourceProvider,
        sourceExternalId: input.sourceExternalId,
      }
      const ownedWhere = { ...ownershipKey, agentId: input.agentId }
      const writableWhere = input.sourceObservedAt ? {
        ...ownedWhere,
        OR: [{ sourceUpdatedAt: null }, { sourceUpdatedAt: { lte: input.sourceObservedAt } }],
      } : ownedWhere
      const hasNewerSnapshot = async () => input.sourceObservedAt && Boolean(await prisma.policy.findFirst({
        where: { ...ownedWhere, sourceUpdatedAt: { gt: input.sourceObservedAt } },
        select: { id: true },
      }))

      // Updating only a row already owned by this agent makes ownership part of
      // the write predicate. A read-then-upsert sequence is racy: two connector
      // runs can both observe absence and the losing ON CONFLICT branch can
      // reassign another tenant's policy.
      const updated = await prisma.policy.updateMany({
        where: writableWhere,
        // `faceAmount` is absent on purpose: the backfill owns that column once
        // it has a real number, and a later sync must not erase it.
        data: mutable,
      })
      if (updated.count > 0) return
      if (await hasNewerSnapshot()) return

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
        where: writableWhere,
        data: mutable,
      })
      if (raced.count === 0 && !await hasNewerSnapshot()) throw new Error('POLICY_OWNERSHIP_CONFLICT')
    },
  }
}
