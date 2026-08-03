export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineWithLevels, getUplineIds } from '@/lib/hierarchy'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { HierarchyCanvas } from './HierarchyCanvas'
import { HierarchyMetrics } from './HierarchyMetrics'
import { ContextPanel } from '@/components/ContextPanel'

export default async function HierarchyPage() {
  const agent = await getCurrentAgent()
  const [user, allAgents] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    prisma.agent.findMany({ include: { user: true } }),
  ])

  const uplineIds = getUplineIds(allAgents, agent.id)
  const downline = getDownlineWithLevels(allAgents, agent.id)
  const levelById = new Map(downline.map((d) => [d.id, d.level]))
  const relevantIds = new Set([...uplineIds, agent.id, ...downline.map((d) => d.id)])

  const canvasAgents = allAgents
    .filter((a) => relevantIds.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.user.name,
      rank: a.rank,
      parentAgentId: a.parentAgentId,
      level: levelById.get(a.id) ?? null,
    }))

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader title="Equipe" eyebrow="Estrutura da agência" description="Veja sua linha de liderança, sua posição e cada agente conectado à produção da sua operação.">
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">{canvasAgents.length} agentes</span>
      </PageHeader>

      <HierarchyMetrics
        uplineCount={uplineIds.length}
        downlineCount={downline.length}
        depth={Math.max(0, ...downline.map((item) => item.level))}
      />

      <div className="module-content-grid">
        <HierarchyCanvas agents={canvasAgents} youId={agent.id} />
        <ContextPanel eyebrow="Continue por aqui" title="Sua posição na estrutura">
          <p>Acima de você estão os responsáveis pela sua linha. Abaixo estão os agentes conectados à sua estrutura.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Impacto</p>
            <p className="mt-2">A estrutura define de onde vêm seus repasses de comissão.</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
