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
        description="Cote o IUL direto na National Life, com os números da própria seguradora."
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
          <p>
            A seguradora precisa do nome, da data de nascimento, do estado de emissão, do sexo,
            da classe de risco e da opção de benefício por morte. A idade ela mesma calcula.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Classe de risco</p>
            <p className="mt-2 text-sm text-ink-muted">
              A National Life tem duas: Standard não-tabagista e Standard tabagista. Não existe classe
              para ex-fumante — onde ele entra é decisão de subscrição sua.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Cobertura</p>
            <p className="mt-2 text-sm text-ink-muted">
              O Rapid Solve cota um único produto, de IUL. Term não é cotado por este portal, e
              Nova York não está entre os estados de emissão.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Integração</p>
            <p className="mt-2 text-sm text-ink-muted">
              A cotação é enviada à National Life e a resposta volta na tela. Se a seguradora
              recusar, o motivo aparece com as palavras dela.
            </p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
