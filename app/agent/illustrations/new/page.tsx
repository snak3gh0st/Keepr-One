import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { NewIllustrationForm } from '../NewIllustrationForm'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function NewIllustrationPage() {
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const localConnector = getNationalLifeLocalConnectorConfig()

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title={copy("Nova ilustração", "New illustration")}
        eyebrow={copy("Carteira", "Portfolio")}
        description={copy("Gere a ilustração oficial no Foresight da National Life.", "Generate the official illustration in National Life Foresight.")}
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          {copy("Voltar para ilustrações", "Back to illustrations")}
        </Link>
      </PageHeader>

      <div className="module-content-grid">
        <div className="min-w-0">
          <NewIllustrationForm
            extensionId={localConnector.enabled ? localConnector.extensionTarget : undefined}
          />
        </div>
        <ContextPanel eyebrow={copy("Dica rápida", "Quick tip")} title={copy("O que enviar", "What to submit")}>
          <p>
            {copy("Informe os dados do segurado e escolha se o cenário será resolvido pelo capital ou pelo prêmio mensal. O K-Bot cria o caso FlexLife no Foresight, confere o resultado calculado e devolve o PDF oficial.", "Enter the insured's information and choose whether the scenario will be solved by face amount or monthly premium. K-Bot creates the FlexLife case in Foresight, checks the calculated result, and returns the official PDF.")}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Classe de risco", "Rate class")}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {copy("Escolha Standard não-tabagista ou Standard tabagista. A classificação é uma decisão de subscrição do agente, não uma inferência do KeeprOne.", "Choose Standard Non-Tobacco or Standard Tobacco. The classification is an underwriting decision by the agent, not an inference made by KeeprOne.")}
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Cobertura", "Coverage")}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {copy("Este fluxo é FlexLife no Foresight. O produto é selecionado e validado pela própria tela da National Life antes de qualquer dado ser gravado.", "This flow uses FlexLife in Foresight. The product is selected and validated on the National Life screen before any data is saved.")}
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">{copy("Integração", "Integration")}</p>
            <p className="mt-2 text-sm text-ink-muted">
              {copy("A geração acontece na sessão autenticada da National Life. Se a sessão expirar, o KeeprOne pede login e retoma o comando aprovado.", "Generation runs in the authenticated National Life session. If the session expires, KeeprOne requests sign-in and resumes the approved command.")}
            </p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
