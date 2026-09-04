import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { Shell } from '@/components/Shell'
import { CrmNavigation } from '@/components/CrmNavigation'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { ModuleSummary } from '@/components/ModuleSummary'
import { ClientsList } from './ClientsList'
import { getServerI18n } from '@/lib/i18n/server'
import { parseClientDirectoryFilters, readClientDirectory } from '@/lib/crm/client-directory'

export const dynamic = 'force-dynamic'

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const scopeAgentIds = await getAgentScopeIds(agent.id)
  const filters = parseClientDirectoryFilters(await searchParams, scopeAgentIds)
  const directory = await readClientDirectory(prisma, scopeAgentIds, filters)

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <div className="space-y-4">
        <CrmNavigation active="clients" />
        <PageHeader title={copy("Clientes", "Clients")} eyebrow={copy("CRM · Relacionamentos", "CRM · Relationships")} description={copy("Sua base organizada para consultar responsáveis, histórico e próximos atendimentos.", "Your organized base for reviewing owners, history, and upcoming cases.")}>
        <Link
          href="/agent/cases/new"
          className="inline-flex items-center gap-2 bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-transform duration-300 hover:-translate-y-0.5"
        >
          <span className="text-success" aria-hidden>+</span>
          {copy("Novo atendimento", "New case")}
        </Link>
        <span className="inline-flex rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal">{directory.total === 1 ? copy("1 cliente", "1 client") : copy("{count} clientes", "{count} clients", { count: directory.total })}</span>
        </PageHeader>
      </div>

      <ModuleSummary
        label={copy("Resumo da base de clientes", "Client base summary")}
        items={[
          { label: copy('Na base', 'In the base'), value: directory.summary.total, detail: copy('Clientes dentro do resultado filtrado', 'Clients in the filtered result') },
          { label: copy('Agentes responsáveis', 'Assigned agents'), value: directory.summary.assignedAgents, detail: copy('Responsáveis pelos clientes no resultado', 'Owners in this result'), tone: 'green' },
          { label: copy('Com contato', 'With contact info'), value: directory.summary.withEmail, detail: copy('Cadastros com e-mail disponível', 'Records with an available email') },
        ]}
      />

      <div className="module-content-grid">
        <section className="module-main-surface">
          <ClientsList {...directory} />
        </section>
        <ContextPanel eyebrow={copy("Continue por aqui", "Continue here")} title={copy("Relacionamento organizado", "Organized relationships")}>
          <p>{copy("Esta lista reúne os clientes que fazem parte do seu acesso atual.", "This list brings together the clients included in your current access.")}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Próximo passo", "Next step")}</p>
            <p className="mt-2">{copy("Inicie um atendimento para conduzir uma oportunidade, ou consulte as apólices já emitidas do cliente.", "Start a case to move an opportunity forward, or review the client's issued policies.")}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
