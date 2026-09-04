import type { PrismaClient } from '@prisma/client'
import { toInforcePolicySnapshot } from './inforce-policy-mapper'
import type { GridRow } from './portal-grid-client'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
import { currentPortfolioFromSnapshot, verifyPortfolioPages } from './current-portfolio'

export async function loadCurrentNationalLifePortfolio(prisma: PrismaClient, agentIds: string[]) {
  const [stored, agents] = await Promise.all([
    prisma.policy.findMany({
      where: { agentId: { in: agentIds }, sourceProvider: 'NATIONAL_LIFE' },
      select: { id: true, carrier: true, product: true, faceAmount: true, statusChangedAt: true, client: { select: { name: true } }, agentId: true, policyNumber: true, clientId: true, status: true,
        sourceStatus: true, premium: true, sourceUpdatedAt: true },
    }),
    prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true } }),
  ])
  const partitions = await Promise.all(agents.map(async (agent) => {
    const owned = stored.filter((row) => row.agentId === agent.id)
    const completion = await prisma.nationalLifeConnectorStageCompletion.findFirst({
      where: { gridKey: 'INFORCE_CLIENTS', truncated: false,
        run: { agentId: agent.id, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } },
      orderBy: { completedAt: 'desc' },
      select: { expectedRecordCount: true, receivedRecordCount: true, finalSequence: true,
        truncated: true, run: { select: { rawGridPages: {
          where: { gridKey: 'INFORCE_CLIENTS' },
          select: { sequence: true, recordCount: true, records: true, observedAt: true },
        } } } },
    })
    if (!completion) return { rows: owned.map((row) => ({
      ...row,
      clientName: row.client?.name ?? '—',
      sourceProvider: 'NATIONAL_LIFE' as const,
      sourceRecordId: `${agent.id}:policy:${row.policyNumber}`,
    })), historicalPolicies: 0, verified: false,
      statusCounts: [], productCounts: [], premiumEvolutionRows: [], observedAt: null }
    const pages = verifyPortfolioPages({ ...completion, pages: completion.run.rawGridPages })
    const rows = pages.flatMap((page) => (page.records as GridRow[]).flatMap((raw) => {
      const row = toInforcePolicySnapshot(raw)
      // The completed run belongs to the paired connector for this agent. The
      // carrier's AgentNumber is source data, not an ownership predicate: an
      // account can legitimately return a different or blank producer number.
      if (!row) return []
      return [{ ...row, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE }]
    }))
    const observedAt = new Date(Math.max(...pages.map((page) => page.observedAt.getTime())))
    const portfolio = currentPortfolioFromSnapshot({ rows, stored: owned, observedAt })
    return {
      ...portfolio,
      rows: portfolio.rows.map((row) => ({
        ...row,
        sourceRecordId: `${agent.id}:policy:${row.policyNumber}`,
      })),
      verified: true,
    }
  }))
  return {
    rows: partitions.flatMap((partition) => partition.rows),
    storedPolicies: stored.length,
    historicalPolicies: partitions.reduce((sum, partition) => sum + partition.historicalPolicies, 0),
    verified: partitions.length > 0 && partitions.every((partition) => partition.verified),
    premiumEvolutionRows: partitions.flatMap((partition) => partition.premiumEvolutionRows),
    observedAt: partitions.some((partition) => partition.observedAt)
      ? new Date(Math.max(...partitions.flatMap((partition) => partition.observedAt ? [partition.observedAt.getTime()] : [])))
      : null,
    statusCounts: [...Map.groupBy(partitions.flatMap((partition) => partition.statusCounts), (row) => row.status)]
      .map(([status, rows]) => ({ status, count: rows.reduce((sum, row) => sum + row.count, 0) }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    productCounts: [...Map.groupBy(partitions.flatMap((partition) => partition.productCounts), (row) => row.product)]
      .map(([product, rows]) => ({ product, count: rows.reduce((sum, row) => sum + row.count, 0) }))
      .sort((a, b) => b.count - a.count || a.product.localeCompare(b.product)),
  }
}
