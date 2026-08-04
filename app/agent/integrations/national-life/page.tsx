import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentSessionSummary } from '@/lib/national-life/interactive-connection-service'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { foresightRunStore } from '@/lib/national-life/foresight-run-service'
import { prisma } from '@/lib/prisma'
import { ContextPanel } from '@/components/ContextPanel'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { EmptyState } from '@/components/Table'
import { NationalLifeConnectionCard } from './NationalLifeConnectionCard'
import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'
import { NationalLifeSyncProgress } from './NationalLifeSyncProgress'
import { NationalLifeForesightProgress } from './NationalLifeForesightProgress'

export const dynamic = 'force-dynamic'

export default async function NationalLifeConnectionPage() {
  const agent = await getCurrentAgent()
  const localConfig = getNationalLifeLocalConnectorConfig()
  const remoteConfigured = isNationalLifeConfigured()
  const remoteEnv = remoteConfigured ? getNationalLifeEnv() : null
  const localSyncStatus = localConfig.enabled
    ? await getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE)
    : null
  const selectedSyncStatus =
    localSyncStatus ??
    (remoteEnv ? await getNationalLifeSyncStatus(agent.id, remoteEnv.sessionScopeId) : null)
  const [user, summary, syncStatus, foresightStatus] = await Promise.all([
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: { name: true, role: true },
    }),
    remoteConfigured ? getAgentSessionSummary(agent.id) : Promise.resolve(null),
    Promise.resolve(selectedSyncStatus),
    remoteEnv
      ? foresightRunStore.getStatus(agent.id, remoteEnv.sessionScopeId)
      : Promise.resolve(null),
  ])

  const role = user?.role === 'ADMIN' ? 'ADMIN' : 'AGENT'
  const backHref = role === 'ADMIN' ? '/admin' : '/agent'

  return (
    <Shell role={role} userName={user?.name ?? ''}>
      <PageHeader
        title="Conexão National Life"
        eyebrow="Integrações"
        description="Conecte com segurança ao portal oficial da National Life e sincronize seus dados."
      >
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded-md border border-teal px-4 py-2.5 text-sm font-semibold text-teal transition-[background-color,border-color,color,transform] duration-150 hover:border-teal-deep hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          ← Voltar
        </Link>
      </PageHeader>

      {localConfig.enabled || remoteConfigured ? (
        <>
          <NationalLifeSyncProgress initialStatus={syncStatus} />
          {remoteConfigured && <NationalLifeForesightProgress initialStatus={foresightStatus} />}
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="max-w-5xl space-y-8">
            {localConfig.enabled && (
              <NationalLifeLocalConnectorCard
                extensionId={localConfig.extensionId}
                storeUrl={localConfig.storeUrl}
                baseUrl={localConfig.baseUrl}
                remoteAvailable={remoteConfigured}
              />
            )}
            {remoteConfigured && (
              <div id="national-life-remote" className="scroll-mt-6">
                {localConfig.enabled && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                      Alternativa automática
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Use a conexão remota se preferir não instalar o KeeproneConnect neste computador.
                    </p>
                  </div>
                )}
                <NationalLifeConnectionCard summary={summary} />
              </div>
            )}
          </div>

          <ContextPanel eyebrow="Guardrails" title="Acesso autorizado e seguro">
            <p>
              Você entra na página real da National Life / Auth0. Sua senha permanece sempre no portal oficial.
            </p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Acesso controlado</p>
              <p className="mt-2 text-sm text-paper/70">
                A sincronização acessa somente as páginas necessárias da National Life.
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
