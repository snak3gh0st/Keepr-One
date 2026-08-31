import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { buildHierarchyOrder } from '@/lib/hierarchy'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { HierarchyBoard } from './HierarchyBoard'
import { ContextPanel } from '@/components/ContextPanel'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function AgentsPage() {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  const agents = await prisma.agent.findMany({ include: { user: true } })
  const byId = new Map(agents.map((a) => [a.id, a]))
  const order = buildHierarchyOrder(agents.map((a) => ({ id: a.id, parentAgentId: a.parentAgentId })))

  const ordered = order.map(({ id, depth }) => {
    const agent = byId.get(id)!
    return { id: agent.id, name: agent.user.name, rank: agent.rank, parentAgentId: agent.parentAgentId, depth }
  })

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Agentes e hierarquia', 'Agents and hierarchy')}
        eyebrow={copy('Estrutura', 'Structure')}
        description={copy(
          'Arraste um agente sobre outro para reatribuir o gerente, ou use "Editar" para ajustar cargo e gerente diretamente.',
          'Drag one agent onto another to reassign the manager, or use "Edit" to adjust the rank and manager directly.',
        )}
      />
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <HierarchyBoard agents={ordered} />
        <ContextPanel eyebrow={copy('Administração', 'Administration')} title={copy('Mantenha a estrutura clara', 'Keep the structure clear')}>
          <p>{copy('Arraste para mudar o gerente. Use editar quando também precisar ajustar o cargo.', 'Drag to change the manager. Use edit when you also need to adjust the rank.')}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy('Segurança', 'Security')}</p>
            <p className="mt-2">{copy('Toda alteração fica registrada na auditoria.', 'Every change is recorded in the audit log.')}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
