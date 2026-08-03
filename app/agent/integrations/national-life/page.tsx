import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentSessionSummary } from '@/lib/national-life/interactive-connection-service'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { prisma } from '@/lib/prisma'
import { ContextPanel } from '@/components/ContextPanel'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { EmptyState } from '@/components/Table'
import { NationalLifeConnectionCard } from './NationalLifeConnectionCard'
import { NationalLifeSyncProgress } from './NationalLifeSyncProgress'

export const dynamic = 'force-dynamic'

export default async function NationalLifeConnectionPage() {
  const agent = await getCurrentAgent()
  const configured = isNationalLifeConfigured()
  const [user, summary, syncStatus] = await Promise.all([
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: { name: true, role: true },
    }),
    configured ? getAgentSessionSummary(agent.id) : Promise.resolve(null),
    configured
      ? getNationalLifeSyncStatus(agent.id, getNationalLifeEnv().sessionScopeId)
      : Promise.resolve(null),
  ])

  const role = user?.role === 'ADMIN' ? 'ADMIN' : 'AGENT'
  const backHref = role === 'ADMIN' ? '/admin' : '/agent'

  return (
    <Shell role={role} userName={user?.name ?? ''}>
      <PageHeader
        title="Conexão National Life"
        eyebrow="Integrações"
        description="Entre diretamente no portal oficial da National Life. O Keepr One guarda somente a sessão autenticada e nunca armazena sua senha."
      >
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded-md border border-teal px-4 py-2.5 text-sm font-semibold text-teal transition-[background-color,border-color,color,transform] duration-150 hover:border-teal-deep hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          ← Voltar
        </Link>
      </PageHeader>

      {configured ? (
        <>
          <NationalLifeSyncProgress initialStatus={syncStatus} />
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="max-w-5xl">
            <NationalLifeConnectionCard summary={summary} />
          </div>

          <ContextPanel eyebrow="Guardrails" title="Acesso autorizado e seguro">
            <p>
              Você entra na página real da National Life / Auth0. O Keepr One preserva somente o contexto autenticado da sessão.
            </p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Sessão isolada</p>
              <p className="mt-2 text-sm text-paper/70">
                A janela segura não possui barra de endereço, downloads ou acesso à área de transferência.
              </p>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Dados protegidos</p>
              <p className="mt-2 text-sm text-paper/70">
                Sua senha é digitada somente no portal oficial e não é armazenada pelo Keepr One.
              </p>
            </div>
          </ContextPanel>
          </div>
        </>
      ) : (
        <div className="mt-8 max-w-5xl">
          <EmptyState>
            Esta integração ainda não foi habilitada neste ambiente. Fale com o time técnico antes de tentar conectar uma conta National Life.
          </EmptyState>
        </div>
      )}
    </Shell>
  )
}
