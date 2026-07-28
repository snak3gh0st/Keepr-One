import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ContextPanel } from '@/components/ContextPanel'
import { NewIllustrationForm } from '../NewIllustrationForm'

export const dynamic = 'force-dynamic'

export default async function NewIllustrationPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Nova ilustração"
        eyebrow="Carteira"
        description="Calcule cotações internas de mercado para Term 15, Term 20, Term 30 e IUL."
      >
        <Link
          href="/agent/policies"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          ← Voltar
        </Link>
      </PageHeader>

      <div className="module-content-grid">
        <div className="min-w-0">
          <NewIllustrationForm />
        </div>
        <ContextPanel eyebrow="Dica rápida" title="O que enviar">
          <p>Informe nome, sobrenome, data de nascimento, idade e situação de tabagismo. O sistema calcula as cotações localmente.</p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Tabagismo</p>
            <p className="mt-2 text-sm text-ink-muted">Use “Não fumante”, “Fumante” ou “Ex-fumante” para manter consistência de cotação.</p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Integração</p>
            <p className="mt-2 text-sm text-ink-muted">
              Não há envio automático neste fluxo. A cotação é feita pela formulação de mercado configurada no servidor (local),
              com ajustes de faixa etária, faixa de cobertura e fator de tabagismo.
            </p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
