import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import { CasesBoard } from './CasesBoard'
import { getPipelineForAgent } from '@/lib/crm'

export const dynamic = 'force-dynamic'

export default async function CasesPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  const scopeAgentIds = [agent.id, ...getDownlineIds(allAgents, agent.id)]

  let cases: Awaited<ReturnType<typeof loadCases>> = []
  let loadError = false
  try {
    cases = await loadCases(scopeAgentIds)
  } catch (error) {
    console.error('Cases query error', error)
    loadError = true
  }

  const pipelines = await Promise.all(scopeAgentIds.map((agentId) => getPipelineForAgent(agentId)))
  const currentPipeline = pipelines.find((pipeline) => pipeline.agentId === agent.id) ?? pipelines[0]
  const stageOptionsByAgent = Object.fromEntries(
    pipelines.map((pipeline) => [pipeline.agentId, pipeline.stages]),
  )

  const boardCases = cases
    .map((c) => ({
      id: c.id,
      assignedAgentId: c.assignedAgentId,
      crmStage: c.crmStage,
      prospectName: `${c.prospect.firstName} ${c.prospect.lastName}`.trim(),
      agentName: c.assignedAgent.user?.name ?? '—',
      productType: c.productType ?? 'UNDECIDED',
      objective: c.objective ?? '—',
      targetCoverage: c.targetCoverage != null ? decimalToNumber(c.targetCoverage).toFixed(2) : null,
      monthlyBudget: c.monthlyBudget != null ? decimalToNumber(c.monthlyBudget).toFixed(2) : null,
      updatedAt: c.updatedAt.toISOString(),
    }))
    .sort((a, b) => {
      const at = ['ACTIVE_CLIENT', 'LOST'].includes(a.crmStage?.systemKey ?? '') ? 1 : 0
      const bt = ['ACTIVE_CLIENT', 'LOST'].includes(b.crmStage?.systemKey ?? '') ? 1 : 0
      if (at !== bt) return at - bt
      return b.updatedAt.localeCompare(a.updatedAt)
    })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      {loadError && <ErrorBanner>Não foi possível carregar suas oportunidades agora. Tente atualizar a página.</ErrorBanner>}
      {!loadError && currentPipeline && (
        <CasesBoard
          cases={boardCases}
          stages={currentPipeline.stages}
          stageOptionsByAgent={stageOptionsByAgent}
        />
      )}
    </Shell>
  )
}

function loadCases(scopeAgentIds: string[]) {
  return prisma.insuranceCase.findMany({
    where: { assignedAgentId: { in: scopeAgentIds } },
    select: {
      id: true,
      assignedAgentId: true,
      crmStage: { select: { id: true, name: true, systemKey: true } },
      objective: true,
      productType: true,
      targetCoverage: true,
      monthlyBudget: true,
      updatedAt: true,
      prospect: { select: { firstName: true, lastName: true } },
      assignedAgent: { select: { user: { select: { name: true } } } },
    },
  })
}
