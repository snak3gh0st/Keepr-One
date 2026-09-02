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
import { getServerI18n } from '@/lib/i18n/server'

export default async function HierarchyPage() {
  const { copy } = await getServerI18n()
  const access = await getCurrentAgentAccess()
  if (!access.canManageTeam) redirect('/agent/agency')

  const agent = await getCurrentAgent()
  const agencyTree = await getAgencyTreeForAgent(agent.id)
  const hierarchyNodes = createHierarchyView(agencyTree, agent.id)
  const summary = getHierarchySummary(hierarchyNodes)
  const peopleLabel = summary.peopleBelow === 1
    ? copy('1 pessoa na equipe abaixo de você', '1 person on the team below you')
    : copy('{count} pessoas na equipe abaixo de você', '{count} people on the team below you', { count: summary.peopleBelow })

  return (
    <Shell role="AGENT" userName={hierarchyNodes[0]?.name ?? ''}>
      <PageHeader
        title={copy('Equipe', 'Team')}
        eyebrow={copy('Mapa da equipe', 'Team map')}
        description={copy('Visualize agentes, subagências e cada ramificação conectada abaixo da sua posição na agência.', 'See agents, sub-agencies, and every branch connected below your position in the agency.')}
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
        <ContextPanel eyebrow={copy('Mapa da equipe', 'Team map')} title={copy('Como ler as ramificações', 'How to read the branches')}>
          <p>{copy('O mapa começa em você e segue por cada agente ou subagência vinculada abaixo da sua posição. Níveis superiores nunca aparecem nesta área.', 'The map starts with you and follows every agent or sub-agency linked below your position. Upline levels never appear here.')}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy('Subagências', 'Sub-agencies')}</p>
            <p className="mt-2">{copy('Quando uma subagência forma sua própria equipe, todos os agentes dela continuam visíveis dentro da mesma ramificação.', 'When a sub-agency builds its own team, all of its agents remain visible within the same branch.')}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
