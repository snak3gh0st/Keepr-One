import type { PrismaClient } from '@prisma/client'
import { toInforcePolicySnapshot } from './inforce-policy-mapper'
import type { GridRow } from './portal-grid-client'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
import { currentPortfolioFromSnapshot, verifyPortfolioPages } from './current-portfolio'
import { memoizeByVersion } from './derivation-cache'

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
    // Identify the completion without pulling its pages. The heavy `records`
    // JSON is fetched inside the memo below, keyed on this id, so a repeat
    // navigation never reads or re-parses it.
    const completion = await prisma.nationalLifeConnectorStageCompletion.findFirst({
      where: { gridKey: 'INFORCE_CLIENTS', truncated: false,
        run: { agentId: agent.id, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, runId: true, expectedRecordCount: true, receivedRecordCount: true,
        finalSequence: true, truncated: true },
    })
    if (!completion) return { rows: owned.map((row) => ({
      ...row,
      clientName: row.client?.name ?? '—',
      sourceProvider: 'NATIONAL_LIFE' as const,
      sourceRecordId: `${agent.id}:policy:${row.policyNumber}`,
    })), historicalPolicies: 0, verified: false,
      statusCounts: [], productCounts: [], premiumEvolutionRows: [], observedAt: null }
    // A completed run is immutable, so its derivation is memoized against the
    // completion id: for a full book this reads and re-parses tens of MB of
    // grid JSON, and every dashboard visit used to pay it again.
    const snapshot = await memoizeByVersion(
      `national-life:inforce:${agent.id}`,
      completion.id,
      async () => {
        const rawGridPages = await prisma.nationalLifeRawGridPage.findMany({
          where: { runId: completion.runId, gridKey: 'INFORCE_CLIENTS' },
          select: { sequence: true, recordCount: true, records: true, observedAt: true },
        })
        // The integrity gate still runs on every derivation, exactly as before.
        const pages = verifyPortfolioPages({ ...completion, pages: rawGridPages })
        const rows = pages.flatMap((page) => (page.records as GridRow[]).flatMap((raw) => {
          const row = toInforcePolicySnapshot(raw)
          // The completed run belongs to the paired connector for this agent. The
          // carrier's AgentNumber is source data, not an ownership predicate: an
          // account can legitimately return a different or blank producer number.
          if (!row) return []
          return [{ ...row, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE }]
        }))
        return {
          rows,
          observedAt: new Date(Math.max(...pages.map((page) => page.observedAt.getTime()))),
        }
      },
    )
    // Stored policies change independently of the carrier snapshot, so this
    // still reconciles against freshly read rows on every request.
    const portfolio = currentPortfolioFromSnapshot({
      rows: snapshot.rows,
      stored: owned,
      observedAt: snapshot.observedAt,
    })
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
