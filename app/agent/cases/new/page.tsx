import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { CrmNavigation } from '@/components/CrmNavigation'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { NewCaseForm } from './NewCaseForm'

export const dynamic = 'force-dynamic'

export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>
}) {
  const { intent } = await searchParams
  const applicationIntent = intent === 'application'
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <div className="space-y-4">
        <CrmNavigation active="opportunities" />
        <PageHeader
          title="Novo atendimento"
          eyebrow="CRM · Nova oportunidade"
          description="Registre o cliente e abra uma oportunidade para conduzir o atendimento até a apólice."
        >
          <Link
            href={applicationIntent ? '/agent/cases?intent=application' : '/agent/cases'}
            className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
          >
            ← Voltar às oportunidades
          </Link>
        </PageHeader>
      </div>
      <div className="module-content-grid">
        <div className="min-w-0">
          <NewCaseForm applicationIntent={applicationIntent} />
        </div>
        <ContextPanel eyebrow="Como funciona" title="Do primeiro contato à apólice">
          <p>A oportunidade começa no primeiro contato e avança pelas etapas do atendimento até a emissão.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Apólice</p>
            <p className="mt-2 text-sm text-ink-muted">
              Nenhuma apólice é criada aqui. Ela aparece quando a oportunidade chega à emissão ou por importação autorizada de histórico.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Seguradora</p>
            <p className="mt-2 text-sm text-ink-muted">National Life Group é a primeira seguradora do fluxo.</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
