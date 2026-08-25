'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  nationalLifeReadCoverageSummary,
} from '@/lib/national-life/read-coverage'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

const POLL_INTERVAL_MS = 1_500
const PORTAL_COVERAGE = nationalLifeReadCoverageSummary()
const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)
export const NATIONAL_LIFE_SYNC_STARTED_EVENT = 'national-life-sync-started'

function safeStatus(value: unknown): NationalLifeSyncStatus | null {
  if (!value || typeof value !== 'object') return null
  return value as NationalLifeSyncStatus
}

function friendlyState(status: NationalLifeSyncStatus) {
  if (status.state === 'PAUSED') return 'Sign in to National Life to keep going.'
  if (status.state === 'PARTIAL' || status.state === 'FAILED') {
    return 'Some areas were updated. Connect again to finish the rest.'
  }
  return null
}

function formatMoment(value: NationalLifeSyncStatus['completedAt']): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/// O que realmente entrou. `writtenRecords` nulo é "não sei" (um run remoto não
/// gera recibo), e nesse caso não se afirma nada. Zero, sim, é uma afirmação: o
/// sync terminou sem trazer nada, e chamar isso de sucesso seria mentir.
function outcomeLine(status: NationalLifeSyncStatus, snapshotRecords: number): string | null {
  if (status.writtenRecords === null) return null
  if (status.writtenRecords === 0) {
    if (snapshotRecords > 0) {
      return `${snapshotRecords.toLocaleString('en-US')} snapshot records were preserved for source mapping.`
    }
    return status.receivedRecords && status.receivedRecords > 0
      ? 'National Life returned records, but none of them could be saved. Try syncing again; if it repeats, contact support.'
      : 'National Life had nothing new to send this time.'
  }
  const plural = status.writtenRecords === 1 ? 'record' : 'records'
  return `${status.writtenRecords.toLocaleString('en-US')} ${plural} saved to Keepr One.`
}

/// The gap between what arrived and what was saved has two causes that mean
/// opposite things. Repeats are how the portal lists a policy once per coverage
/// — merging them loses nothing. Rows without a policy number cannot be keyed
/// and are the only real loss. Printing the difference alone would read as 165
/// missing policies and send the agent to support over routine housekeeping.
function discardLine(status: NationalLifeSyncStatus, snapshotRecords: number): string | null {
  const repeated = status.duplicateRecords ?? 0
  const dropped = status.rejectedRecords ?? 0
  if (repeated === 0 && dropped === 0 && snapshotRecords === 0) return null
  const sentences: string[] = []
  if (repeated > 0) {
    sentences.push(
      `${repeated.toLocaleString('en-US')} repeated a policy already listed and were merged.`,
    )
  }
  if (dropped > 0) {
    sentences.push(
      `${dropped.toLocaleString('en-US')} could not be saved because they arrived without a policy number.`,
    )
  }
  if (snapshotRecords > 0) {
    sentences.push(
      `${snapshotRecords.toLocaleString('en-US')} snapshot records were preserved separately and are not counted as operational rows.`,
    )
  }
  return sentences.join(' ')
}

function snapshotRecordCount(status: NationalLifeSyncStatus): number {
  return status.stageCoverage?.reduce((total, stage) => (
    DISCOVERY_PAGE_KEYS.has(stage.gridKey) ? total + (stage.verifiedRecords ?? 0) : total
  ), 0) ?? 0
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}

function activeLine(status: NationalLifeSyncStatus, reused: number): string {
  const checked = status.completed + status.failed
  const reusePrefix = reused > 0
    ? `${reused} previously verified ${reused === 1 ? 'area was' : 'areas were'} reused. `
    : ''
  if (!status.currentGridLabel) return `${reusePrefix}${checked} of ${status.total} areas checked.`
  if (status.receivedRecords !== null && status.receivedRecords > 0) {
    return `${reusePrefix}Reading and saving ${status.currentGridLabel}. ${formatCount(status.receivedRecords)} rows received so far.`
  }
  return `${reusePrefix}Reading and saving ${status.currentGridLabel}.`
}

function coverageTone(state: NonNullable<NationalLifeSyncStatus['stageCoverage']>[number]['state']) {
  if (state === 'VERIFIED') return 'border-teal/30 bg-teal-pale/45 text-teal-deep'
  if (state === 'REUSED') return 'border-teal/30 bg-teal-pale/25 text-teal-deep'
  if (state === 'CAPTURED') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (state === 'READING') return 'border-gold/40 bg-gold-pale text-gold-ink'
  if (state === 'FAILED') return 'border-red-300 bg-red-50 text-red-700'
  return 'border-border-steel bg-panel/55 text-ink-muted'
}

function coverageLabel(state: NonNullable<NationalLifeSyncStatus['stageCoverage']>[number]['state']) {
  if (state === 'VERIFIED') return 'Verified'
  if (state === 'REUSED') return 'Reused'
  if (state === 'CAPTURED') return 'Captured'
  if (state === 'READING') return 'Reading'
  if (state === 'FAILED') return 'Needs retry'
  return 'Waiting'
}

export function NationalLifeSyncProgress({
  initialStatus,
}: {
  initialStatus: NationalLifeSyncStatus | null
}) {
  const [status, setStatus] = useState<NationalLifeSyncStatus | null>(initialStatus)
  const [pollingEnabled, setPollingEnabled] = useState(Boolean(initialStatus?.shouldPoll))

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent/integrations/national-life/sync', {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as { run?: unknown }
        const next = safeStatus(body.run)
        if (alive && next) {
          setStatus(next)
          if (!next.shouldPoll) setPollingEnabled(false)
        }
      } catch {
        // Keep the last known progress. A transient status request must not
        // turn a real bar into an empty state.
      }
    }

    const onSyncStarted = () => {
      setPollingEnabled(true)
      void refresh()
    }
    window.addEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)

    if (!pollingEnabled) {
      return () => window.removeEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)
    }

    void refresh()
    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, onSyncStarted)
    }
  }, [pollingEnabled])

  if (!status) {
    return (
      <section
        aria-label="National Life sync progress"
        className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Sync status</p>
        <h2 className="mt-1 text-lg font-semibold text-ink">Ready to bring National Life into Keepr One</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Start a sync above and this panel will show each area as it is read from National Life and saved here.
        </p>
        <div className="mt-5 flex items-center justify-between rounded-xl border border-border-steel bg-panel/55 px-4 py-3 text-sm">
          <span className="font-medium text-ink">No sync has started on this account yet.</span>
          <span className="text-ink-muted">Waiting for your first run</span>
        </div>
      </section>
    )
  }

  const message = friendlyState(status)
  const terminal = status.state === 'COMPLETED' || status.state === 'PARTIAL' || status.state === 'FAILED'
  const active = status.shouldPoll
  const checked = Math.min(status.total, status.completed + status.failed)
  const reused = status.stageCoverage?.filter((stage) => stage.state === 'REUSED').length ?? 0
  const snapshotRecords = snapshotRecordCount(status)
  const plannedSnapshotSources = status.stageCoverage?.filter((stage) =>
    DISCOVERY_PAGE_KEYS.has(stage.gridKey),
  ).length ?? 0
  const plannedStructuredSources = Math.max(0, (status.stageCoverage?.length ?? 0) - plannedSnapshotSources)
  const lastSynced = formatMoment(status.completedAt)
  // Só depois do fim. No meio do run, "nada novo desta vez" ou "120 gravados"
  // seriam a mesma mentira do "concluído" eterno, apontada para o outro lado.
  const outcome = terminal ? outcomeLine(status, snapshotRecords) : null
  const discards = terminal ? discardLine(status, snapshotRecords) : null

  return (
    <section
      aria-label="National Life sync progress"
      aria-busy={active}
      className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Sync</p>
            {active && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-pale px-2 py-1 text-[11px] font-semibold text-teal-deep">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
                Live
              </span>
            )}
          </div>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {status.state === 'COMPLETED'
              ? 'Your priority National Life data is up to date'
              : terminal
                ? 'Sync finished with areas to retry'
                : 'Updating your National Life data'}
          </h2>
          {terminal && lastSynced && (
            <p className="mt-1 text-sm text-ink-muted">Last synced {lastSynced}</p>
          )}
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-teal">
          {checked} of {status.total} portal areas checked
        </span>
      </div>

      <progress
        aria-label="Update progress"
        className="mt-5 h-2 w-full overflow-hidden rounded-full accent-teal"
        max={status.total}
        value={checked}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          {outcome ?? activeLine(status, reused)}
          {discards && <span className="block text-xs text-ink-muted">{discards}</span>}
        </span>
        {message && (
          <span className="font-semibold text-gold">
            {message}
            {status.state === 'PAUSED' && (
              <Link className="ml-2 underline" href="/agent/integrations/national-life">
                Connect
              </Link>
            )}
          </span>
        )}
      </div>

      {active && status.failed > 0 && (
        <div className="mt-4 rounded-xl border border-gold/35 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
          {status.failed} {status.failed === 1 ? 'area could' : 'areas could'} not be read. The sync is continuing with the remaining areas.
        </div>
      )}

      <div className={`mt-5 grid overflow-hidden rounded-lg border border-border-steel bg-panel/55 divide-y divide-border-steel sm:divide-x sm:divide-y-0 ${snapshotRecords > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Received from National Life</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.receivedRecords)}</p>
          <p className="mt-1 text-xs text-ink-muted">Rows delivered by the portal</p>
        </div>
        <div className="bg-teal-pale/45 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">Structured in Keepr One</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.writtenRecords)}</p>
          <p className="mt-1 text-xs text-ink-muted">Rows written to your National Life data</p>
        </div>
        {snapshotRecords > 0 && (
          <div className="bg-blue-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-800">Source snapshots preserved</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
              {snapshotRecords.toLocaleString('en-US')}
            </p>
            <p className="mt-1 text-xs text-ink-muted">Kept for mapping, not shown as operational rows</p>
          </div>
        )}
      </div>

      {status.stageCoverage && status.stageCoverage.length > 0 && (
        <div className="mt-5 border-t border-border-steel pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Portal source coverage</p>
            <p className="text-xs text-ink-muted">
              Reused areas were already verified in the previous attempt.
            </p>
          </div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {status.stageCoverage.map((stage) => (
              <li key={stage.gridKey} className={`rounded-lg border px-3 py-2 text-xs ${coverageTone(stage.state)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{stage.label ?? stage.gridKey.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-mono text-[10px] uppercase">{coverageLabel(stage.state)}</span>
                </div>
                {stage.verifiedRecords !== null && (
                  <p className="mt-1 font-mono tabular-nums">
                    {stage.verifiedRecords.toLocaleString('en-US')}{' '}
                    {stage.state === 'CAPTURED' ? 'snapshot records captured' : 'rows verified'}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-steel bg-panel/45 px-3 py-2 text-xs text-ink-muted">
            <span>
              Current plan: {plannedStructuredSources} structured
              {plannedSnapshotSources > 0 ? ` + ${plannedSnapshotSources} snapshot sources` : ''}
            </span>
            <span className="font-mono font-semibold tabular-nums text-ink">
              Connector supports {PORTAL_COVERAGE.automatic} of {PORTAL_COVERAGE.required} known sources
            </span>
          </div>
        </div>
      )}

      {active && (
        <p className="mt-4 text-xs leading-5 text-ink-muted">
          Data is saved in batches as each area finishes. You can leave this page open while the portal is being read.
        </p>
      )}
    </section>
  )
}
