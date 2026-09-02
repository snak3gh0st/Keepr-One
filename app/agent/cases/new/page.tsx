import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { CrmNavigation } from '@/components/CrmNavigation'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { NewCaseForm } from './NewCaseForm'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function NewCasePage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <div className="space-y-4">
        <CrmNavigation active="opportunities" />
        <PageHeader
          title={copy("Novo atendimento", "New case")}
          eyebrow={copy("CRM · Nova oportunidade", "CRM · New opportunity")}
          description={copy("Registre o cliente e abra uma oportunidade para conduzir o atendimento até a apólice.", "Register the client and open an opportunity to guide the case through policy issuance.")}
        >
          <Link
            href="/agent/cases"
            className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
          >
            ← {copy("Voltar às oportunidades", "Back to opportunities")}
          </Link>
        </PageHeader>
      </div>
      <div className="module-content-grid">
        <div className="min-w-0">
          <NewCaseForm />
        </div>
        <ContextPanel eyebrow={copy("Como funciona", "How it works")} title={copy("Do primeiro contato à apólice", "From first contact to policy") }>
          <p>{copy("A oportunidade começa no primeiro contato e avança pelas etapas do atendimento até a emissão.", "The opportunity begins at first contact and moves through the case stages until issuance.")}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Apólice", "Policy")}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {copy("Nenhuma apólice é criada aqui. Ela aparece quando a oportunidade chega à emissão ou por importação autorizada de histórico.", "No policy is created here. It appears when the opportunity reaches issuance or through an authorized historical import.")}
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Seguradora", "Carrier")}</p>
            <p className="mt-2 text-sm text-ink-muted">{copy("National Life Group é a primeira seguradora do fluxo.", "National Life Group is the first carrier in this workflow.")}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
