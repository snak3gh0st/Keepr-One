import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function NewPolicyPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title={copy("Apólices não são criadas manualmente", "Policies are not created manually")}
        eyebrow={copy("Como funciona", "How it works")}
        description={copy("Uma apólice representa um contrato real — ela surge quando uma oportunidade chega à emissão ou por uma importação de histórico autorizada.", "A policy represents a real contract — it appears when an opportunity reaches issue or through an authorized historical import.")}
      >
        <Link
          href="/agent/policies"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          ← {copy("Voltar", "Back")}
        </Link>
      </PageHeader>
      <div className="module-content-grid">
        <section className="module-main-surface">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy("Origem da carteira", "Portfolio source")}</p>
          <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{copy("Por onde uma apólice aparece", "How a policy appears")}</h2>
          <ol className="mt-6 grid gap-3 sm:grid-cols-2">
            <li className="rounded-2xl border border-border-steel bg-panel/55 p-5">
              <span className="font-mono text-xs text-teal">01</span>
              <strong className="mt-8 block text-lg font-medium tracking-[-0.03em] text-ink">{copy("Emissão de uma oportunidade", "Opportunity issue")}</strong>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {copy("Registre o cliente e conduza o atendimento pelas etapas. A apólice surge quando a oportunidade chega à emissão.", "Register the client and move the case through its stages. The policy appears when the opportunity reaches issue.")}
              </p>
            </li>
            <li className="rounded-2xl border border-border-steel bg-panel/55 p-5">
              <span className="font-mono text-xs text-teal">02</span>
              <strong className="mt-8 block text-lg font-medium tracking-[-0.03em] text-ink">{copy("Importação de histórico", "Historical import")}</strong>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {copy("Contratos existentes entram por importação autorizada, preservando sua origem e o número original.", "Existing contracts enter through an authorized import, preserving their source and original number.")}
              </p>
            </li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/agent/cases/new"
              className="inline-flex min-h-11 items-center rounded-full bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
            >
              {copy("Novo atendimento", "New case")}
            </Link>
            <Link
              href="/agent/cases"
              className="inline-flex min-h-11 items-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-ink-muted hover:bg-panel"
            >
              {copy("Ver oportunidades", "View opportunities")}
            </Link>
          </div>
        </section>
        <ContextPanel eyebrow={copy("Por quê", "Why")} title={copy("Origem controlada", "Controlled source")}>
          <p>{copy("Impedir a criação manual garante que toda apólice tenha uma oportunidade ou uma importação por trás — sem números soltos.", "Preventing manual creation ensures every policy is backed by an opportunity or import — with no disconnected records.")}</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Importação", "Import")}</p>
            <p className="mt-2 text-sm text-ink-muted">{copy("A importação de histórico é feita pela administração em “Importar dados”.", "Historical imports are performed by an administrator under “Import data”.")}</p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
