import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import { CasesBoard } from './CasesBoard'
import { findPipelineForAgent, getPipelineForAgent } from '@/lib/crm'
import { getCurrentSession, getServerI18n } from '@/lib/i18n/server'
import { isReadOnlySupportPreview } from '@/lib/support-preview'

export const dynamic = 'force-dynamic'

export default async function CasesPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const readOnly = isReadOnlySupportPreview(await getCurrentSession())
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const scopeAgentIds = await getAgentScopeIds(agent.id)

  let cases: Awaited<ReturnType<typeof loadCases>> = []
  let loadError = false
  try {
    cases = await loadCases(scopeAgentIds)
  } catch (error) {
    console.error('Cases query error', error)
    loadError = true
  }

  const pipelines = await Promise.all(scopeAgentIds.map((agentId) => (
    readOnly ? findPipelineForAgent(agentId) : getPipelineForAgent(agentId)
  )))
  const currentPipeline = pipelines.find((pipeline) => pipeline?.agentId === agent.id)
    ?? pipelines.find((pipeline) => pipeline !== null)
  const stageOptionsByAgent = Object.fromEntries(
    pipelines.flatMap((pipeline) => pipeline ? [[pipeline.agentId, pipeline.stages]] : []),
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
      {loadError && <ErrorBanner>{copy('Não foi possível carregar suas oportunidades agora. Tente atualizar a página.', 'Your opportunities could not be loaded right now. Try refreshing the page.')}</ErrorBanner>}
      {!loadError && !currentPipeline && (
        <p className="rounded-xl border border-border-steel bg-panel px-4 py-3 text-sm text-ink-muted" role="status">
          {copy('O pipeline deste agente ainda não foi configurado. No modo de suporte, nada foi criado.', 'This agent has no configured pipeline yet. Nothing was created in support mode.')}
        </p>
      )}
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
