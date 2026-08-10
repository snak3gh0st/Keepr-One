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
        title="Connect National Life"
        eyebrow="Integrations"
        description="Bring your National Life book of business into Keepr One with a connection you can see and control."
      >
        <Link
          href={backHref}
          className="inline-flex min-h-10 items-center rounded-md border border-teal px-4 py-2.5 text-sm font-semibold text-teal transition-[background-color,border-color,color,transform] duration-150 hover:border-teal-deep hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          ← Back to operations
        </Link>
      </PageHeader>

      {localConfig.enabled || remoteConfigured ? (
        <div className="mt-8 max-w-6xl space-y-8">
          <section className="relative overflow-hidden rounded-[28px] border border-border-steel bg-paper shadow-[var(--shadow-card)]">
            <div
              aria-hidden="true"
              className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-teal-pale/75 blur-3xl"
            />
            <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:p-10">
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rail-strong text-sm font-bold tracking-[0.12em] text-paper shadow-[0_10px_24px_rgba(21,45,43,0.16)]">
                    NL
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-deep">
                      National Life · secure connection
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">Read the official portal. Keep the data here.</p>
                  </div>
                </div>
                <h2 className="mt-8 max-w-xl text-balance text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
                  Connect once. Keep your book of business moving.
                </h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-ink-muted">
                  Keepr One reads the areas you authorize and saves each completed batch so you can see the work as it happens.
                </p>
                <div className="mt-7 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-teal-pale px-3 py-2 text-xs font-semibold text-teal-deep">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
                    Password stays on National Life
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-2 text-xs font-semibold text-ink-muted">
                    Read-only sync
                  </span>
                </div>
              </div>

              <ol aria-label="Connection steps" className="grid content-center gap-3">
                {[
                  ['01', 'Open the connector', 'Use Chrome or Edge on this computer.'],
                  ['02', 'Sign in on National Life', 'Your credentials stay on the official portal.'],
                  ['03', 'Watch the import', 'Keepr One shows what was received and saved.'],
                ].map(([number, title, copy]) => (
                  <li
                    key={number}
                    className="grid grid-cols-[2.25rem_1fr] gap-3 rounded-2xl border border-border-steel bg-panel/55 p-4"
                  >
                    <span className="font-mono text-sm font-semibold tabular-nums text-teal">{number}</span>
                    <span>
                      <strong className="block text-sm font-semibold text-ink">{title}</strong>
                      <span className="mt-1 block text-sm leading-5 text-ink-muted">{copy}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {localConfig.enabled && (
            <NationalLifeLocalConnectorCard
              extensionId={localConfig.extensionId}
              storeUrl={localConfig.storeUrl}
              installMode={localConfig.installMode}
              baseUrl={localConfig.baseUrl}
              remoteAvailable={remoteConfigured}
            />
          )}

          <NationalLifeSyncProgress initialStatus={syncStatus} />
          {remoteConfigured && <NationalLifeForesightProgress initialStatus={foresightStatus} />}

          {remoteConfigured && (
            <details id="national-life-remote" className="scroll-mt-6 group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl border border-border-steel bg-paper px-5 py-4 shadow-[var(--shadow-card)] transition-colors hover:border-ink-muted sm:px-6">
                <span>
                  <span className="block text-sm font-semibold text-ink">Use the automatic connection instead</span>
                  <span className="mt-1 block text-sm text-ink-muted">A remote browser handles the portal without an extension on this computer.</span>
                </span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-xl text-ink-muted transition-transform duration-200 group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <div className="pt-5">
                <NationalLifeConnectionCard summary={summary} />
              </div>
            </details>
          )}

          <p className="border-t border-border-steel pt-5 text-sm leading-6 text-ink-muted">
            National Life data is copied into Keepr One as a read-only snapshot.{' '}
            <Link href="/agent/integrations/national-life/data" className="font-semibold text-teal underline-offset-4 hover:underline">
              View saved data
            </Link>
          </p>
          </div>
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
