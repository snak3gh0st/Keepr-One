import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentConnectionSummary } from '@/lib/national-life/connection-service'
import { prisma } from '@/lib/prisma'
import { ContextPanel } from '@/components/ContextPanel'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { NationalLifeConnectionForm } from './NationalLifeConnectionForm'

export const dynamic = 'force-dynamic'

export default async function NationalLifeConnectionPage() {
  const agent = await getCurrentAgent()
  const [user, summary] = await Promise.all([
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: { name: true, role: true },
    }),
    getAgentConnectionSummary(agent.id),
  ])

  const role = user?.role === 'ADMIN' ? 'ADMIN' : 'AGENT'
  const backHref = role === 'ADMIN' ? '/admin' : '/agent'

  return (
    <Shell role={role} userName={user?.name ?? ''}>
      <PageHeader
        title="Conexão National Life"
        eyebrow="Integrações"
        description="Gerencie a credencial do agente para o portal da National Life sem expor senha, cookies ou dados sensíveis no cliente."
      >
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded-md border border-teal px-4 py-2.5 text-sm font-semibold text-teal transition-[background-color,border-color,color,transform] duration-150 hover:border-teal-deep hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          ← Voltar
        </Link>
      </PageHeader>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="max-w-5xl">
          <NationalLifeConnectionForm summary={summary} />
        </div>

        <ContextPanel eyebrow="Guardrails" title="Acesso autorizado e seguro">
          <p>
            Esta área salva a credencial por agente, mostra apenas identidade mascarada e nunca devolve a senha para o navegador.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Teste de conexão</p>
            <p className="mt-2 text-sm text-paper/70">
              O teste cria um job durável para o worker. Nenhum browser automation roda dentro da requisição.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Dados protegidos</p>
            <p className="mt-2 text-sm text-paper/70">
              Não use credenciais reais neste branch de desenvolvimento e nunca cole cookies, tokens ou dados de health aqui.
            </p>
          </div>
        </ContextPanel>
      </div>
    </Shell>
  )
}
