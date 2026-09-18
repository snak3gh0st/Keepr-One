import Link from 'next/link'
import { getServerI18n } from '@/lib/i18n/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { Shell } from '@/components/Shell'
import { CrmNavigation } from '@/components/CrmNavigation'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { LeadImportForm } from './LeadImportForm'

export const dynamic = 'force-dynamic'

export default async function AgentLeadImportPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId }, select: { name: true } })
  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <div className="space-y-4">
        <CrmNavigation active="opportunities" />
        <PageHeader
          title={copy('Importar leads', 'Import leads')}
          eyebrow={copy('CRM · Entrada em lote', 'CRM · Bulk intake')}
          description={copy('Traga seus contatos para o pipeline sem criar duplicatas na sua carteira.', 'Bring contacts into your pipeline without creating duplicates in your book.')}
        >
          <Link href="/agent/cases" className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]">
            ← {copy('Voltar ao CRM', 'Back to CRM')}
          </Link>
        </PageHeader>
      </div>
      <div className="module-content-grid">
        <LeadImportForm />
        <ContextPanel eyebrow={copy('Importação segura', 'Safe import')} title={copy('Um lead, uma oportunidade', 'One lead, one opportunity')}>
          <p>{copy('Cada linha válida cria um Prospect e uma oportunidade na etapa Novo Lead. E-mail e telefone são usados para ignorar duplicatas do mesmo agente.', 'Each valid row creates a Prospect and an opportunity in the New Lead stage. Email and phone are used to skip duplicates for the same agent.')}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy('Limite', 'Limit')}</p>
            <p className="mt-2 text-sm text-ink-muted">{copy('Até 2.000 linhas e 5 MB por arquivo.', 'Up to 2,000 rows and 5 MB per file.')}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
