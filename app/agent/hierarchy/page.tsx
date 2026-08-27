export const dynamic = 'force-dynamic'

import { getCurrentAgent } from '@/lib/agent-context'
import { getCurrentAgentAccess } from '@/lib/agent-access'
import { getAgencyTreeForAgent } from '@/lib/agency-tree'
import { redirect } from 'next/navigation'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { HierarchyCanvas } from './HierarchyCanvas'
import { HierarchyMetrics } from './HierarchyMetrics'
import { ContextPanel } from '@/components/ContextPanel'
import { createHierarchyView, getHierarchySummary } from './view-model'

export default async function HierarchyPage() {
  const access = await getCurrentAgentAccess()
  if (!access.canManageTeam) redirect('/agent/agency')

  const agent = await getCurrentAgent()
  const agencyTree = await getAgencyTreeForAgent(agent.id)
  const hierarchyNodes = createHierarchyView(agencyTree, agent.id)
  const summary = getHierarchySummary(hierarchyNodes)
  const peopleLabel = summary.peopleBelow === 1
    ? '1 pessoa abaixo de você'
    : `${summary.peopleBelow} pessoas abaixo de você`

  return (
    <Shell role="AGENT" userName={hierarchyNodes[0]?.name ?? ''}>
      <PageHeader
        title="Minha estrutura"
        eyebrow="Árvore da agência"
        description="Esta visão começa em você e mostra, em ordem, somente agentes e agências conectados abaixo da sua posição."
      >
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">
          {peopleLabel}
        </span>
      </PageHeader>

      <HierarchyMetrics
        peopleBelow={summary.peopleBelow}
        agenciesBelow={summary.agenciesBelow}
        depth={summary.depth}
      />

      <div className="module-content-grid">
        <HierarchyCanvas agents={hierarchyNodes} />
        <ContextPanel eyebrow="Limite da visão" title="Sua árvore começa aqui">
          <p>Você vê seu próprio nome e cada ramo formado abaixo da sua posição. Pessoas acima de você nunca aparecem nesta área.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Subagências</p>
            <p className="mt-2">Quando um agente abaixo de você cria uma agência, a equipe dele continua dentro do mesmo ramo.</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
