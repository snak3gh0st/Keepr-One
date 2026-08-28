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
    ? '1 pessoa na equipe abaixo de você'
    : `${summary.peopleBelow} pessoas na equipe abaixo de você`

  return (
    <Shell role="AGENT" userName={hierarchyNodes[0]?.name ?? ''}>
      <PageHeader
        title="Equipe"
        eyebrow="Mapa da equipe"
        description="Visualize agentes, subagências e cada ramificação conectada abaixo da sua posição na agência."
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
        <ContextPanel eyebrow="Mapa da equipe" title="Como ler as ramificações">
          <p>O mapa começa em você e segue por cada agente ou subagência vinculada abaixo da sua posição. Níveis superiores nunca aparecem nesta área.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Subagências</p>
            <p className="mt-2">Quando uma subagência forma sua própria equipe, todos os agentes dela continuam visíveis dentro da mesma ramificação.</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
