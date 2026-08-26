import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { NewIllustrationForm } from '../NewIllustrationForm'
import { getNationalLifeLocalConnectorConfig } from '@/lib/national-life/local-connector/config'

export const dynamic = 'force-dynamic'

export default async function NewIllustrationPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const localConnector = getNationalLifeLocalConnectorConfig()

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Nova ilustração"
        eyebrow="Carteira"
        description="Gere a ilustração oficial FlexLife no Foresight da National Life."
      >
        <Link
          href="/agent/illustrations"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Voltar para ilustrações
        </Link>
      </PageHeader>

      <div className="module-content-grid">
        <div className="min-w-0">
          <NewIllustrationForm
            extensionId={localConnector.enabled ? localConnector.extensionId : undefined}
          />
        </div>
        <ContextPanel eyebrow="Dica rápida" title="O que enviar">
          <p>
            Informe os dados do segurado, o capital e o prêmio mensal. O KeeproneConnect cria
            o caso FlexLife no Foresight, confere o que foi gravado e devolve o PDF oficial.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Classe de risco</p>
            <p className="mt-2 text-sm text-ink-muted">
              Escolha Standard não-tabagista ou Standard tabagista. A classificação é uma decisão
              de subscrição do agente, não uma inferência do KeeprOne.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Cobertura</p>
            <p className="mt-2 text-sm text-ink-muted">
              Este fluxo é FlexLife no Foresight. O produto é selecionado e validado pela própria
              tela da National Life antes de qualquer dado ser gravado.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Integração</p>
            <p className="mt-2 text-sm text-ink-muted">
              A geração acontece na sessão autenticada da National Life. Se a sessão expirar,
              o KeeprOne pede login e retoma o comando aprovado.
            </p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
