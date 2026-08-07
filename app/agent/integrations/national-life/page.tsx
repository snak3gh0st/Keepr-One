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
        title="National Life connection"
        eyebrow="Integrations"
        description="Connect securely to the official National Life portal and sync your data."
      >
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded-md border border-teal px-4 py-2.5 text-sm font-semibold text-teal transition-[background-color,border-color,color,transform] duration-150 hover:border-teal-deep hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          ← Back
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
                installMode={localConfig.installMode}
                baseUrl={localConfig.baseUrl}
                remoteAvailable={remoteConfigured}
              />
            )}
            {remoteConfigured && (
              <div id="national-life-remote" className="scroll-mt-6">
                {localConfig.enabled && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                      Automatic option
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Use the remote connection if you would rather not install KeeproneConnect on this computer.
                    </p>
                  </div>
                )}
                <NationalLifeConnectionCard summary={summary} />
              </div>
            )}
          </div>

          <ContextPanel eyebrow="Guardrails" title="Authorized, secure access">
            <p>
              You sign in on the real National Life / Auth0 page. Your password stays on the official portal at all times.
            </p>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Limited access</p>
              <p className="mt-2 text-sm text-paper/70">
                The sync only opens the National Life pages it needs.
              </p>
            </div>
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Protected data</p>
              <p className="mt-2 text-sm text-paper/70">
                Your password is typed only on the official portal and is never stored by Keepr One.
              </p>
            </div>
          </ContextPanel>
          </div>
        </>
      ) : (
        <div className="mt-8 max-w-5xl">
          <EmptyState>
            This integration is not enabled yet. Contact Keepr One support before trying to connect a National Life account.
          </EmptyState>
        </div>
      )}
    </Shell>
  )
}
