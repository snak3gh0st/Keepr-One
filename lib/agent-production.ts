export function getMonthBounds(period: string): { start: Date; end: Date } {
  const [yearStr, monthStr] = period.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 1))
  return { start, end }
}

export type ProductionRow = {
  agentId: string
  agentName: string
  policyCount: number
  premiumTotal: number
  commissionTotal: number
}

export function buildProductionRanking(
  agents: { id: string; name: string }[],
  policyStats: { agentId: string; count: number; premiumSum: number }[],
  commissionStats: { agentId: string; sum: number }[],
): ProductionRow[] {
  const policyByAgent = new Map(policyStats.map((p) => [p.agentId, p]))
  const commissionByAgent = new Map(commissionStats.map((c) => [c.agentId, c.sum]))

  const rows = agents.map((agent) => {
    const policy = policyByAgent.get(agent.id)
    return {
      agentId: agent.id,
      agentName: agent.name,
      policyCount: policy?.count ?? 0,
      premiumTotal: policy?.premiumSum ?? 0,
      commissionTotal: commissionByAgent.get(agent.id) ?? 0,
    }
  })

  return rows.sort((a, b) => b.commissionTotal - a.commissionTotal)
}
