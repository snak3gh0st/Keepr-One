import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { Shell } from '@/components/Shell'
import { CrmNavigation } from '@/components/CrmNavigation'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { ModuleSummary } from '@/components/ModuleSummary'
import { ClientsList } from './ClientsList'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  const scopeAgentIds = [agent.id, ...getDownlineIds(allAgents, agent.id)]

  const clients = await prisma.client.findMany({
    where: { assignedAgentId: { in: scopeAgentIds } },
    include: { assignedAgent: { include: { user: true } } },
    orderBy: { name: 'asc' },
  })
  const agentsWithClients = new Set(clients.map((client) => client.assignedAgentId)).size
  const clientsWithEmail = clients.filter((client) => Boolean(client.email)).length

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <div className="space-y-4">
        <CrmNavigation active="clients" />
        <PageHeader title="Clientes" eyebrow="CRM · Relacionamentos" description="Sua base organizada para consultar responsáveis, histórico e próximos atendimentos.">
        <Link
          href="/agent/cases/new"
          className="inline-flex items-center gap-2 bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-transform duration-300 hover:-translate-y-0.5"
        >
          <span className="text-success" aria-hidden>+</span>
          Novo atendimento
        </Link>
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">{clients.length} clientes</span>
        </PageHeader>
      </div>

      <ModuleSummary
        label="Resumo da base de clientes"
        items={[
          { label: 'Na base', value: clients.length, detail: 'Clientes dentro do seu escopo' },
          { label: 'Agentes responsáveis', value: agentsWithClients, detail: 'Pessoas da equipe com clientes ativos', tone: 'green' },
          { label: 'Com contato', value: clientsWithEmail, detail: 'Cadastros com e-mail disponível' },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface">
          <ClientsList
            clients={clients.map((c) => ({
              id: c.id,
              name: c.name,
              email: c.email,
              agentId: c.assignedAgentId,
              agentName: c.assignedAgent.user.name,
            }))}
          />
        </section>
        <ContextPanel eyebrow="Continue por aqui" title="Relacionamento organizado">
          <p>Esta lista reúne seus clientes e os clientes dos agentes abaixo de você na hierarquia.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Próximo passo</p>
            <p className="mt-2">Inicie um atendimento para conduzir uma oportunidade, ou consulte as apólices já emitidas do cliente.</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
