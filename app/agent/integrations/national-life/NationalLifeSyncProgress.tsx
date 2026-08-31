'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  NATIONAL_LIFE_PRIORITY_GRID_KEYS,
  nationalLifeReadCoverageSummary,
} from '@/lib/national-life/read-coverage'
import { NATIONAL_LIFE_PERSONAL_GRID_KEYS } from '@/lib/national-life/plan-access-catalog'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { KBotActivity, type KBotState } from '@/components/kbot/KBotAvatar'

const POLL_INTERVAL_MS = 1_500
const PORTAL_COVERAGE = nationalLifeReadCoverageSummary()
const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)
const STRUCTURED_PRIORITY_GRID_KEYS = NATIONAL_LIFE_PRIORITY_GRID_KEYS.filter(
  (gridKey) => !DISCOVERY_PAGE_KEYS.has(gridKey),
)
const PERSONAL_GRID_KEYS = new Set<string>(NATIONAL_LIFE_PERSONAL_GRID_KEYS)
const PERSONAL_PRIORITY_GRID_KEYS = NATIONAL_LIFE_PRIORITY_GRID_KEYS.filter(
  (gridKey) => PERSONAL_GRID_KEYS.has(gridKey),
)
const PERSONAL_STRUCTURED_PRIORITY_GRID_KEYS = STRUCTURED_PRIORITY_GRID_KEYS.filter(
  (gridKey) => PERSONAL_GRID_KEYS.has(gridKey),
)
export const NATIONAL_LIFE_SYNC_STARTED_EVENT = 'national-life-sync-started'
export const NATIONAL_LIFE_RETRY_REMAINING_EVENT = 'national-life-retry-remaining'

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

function estimateLine(status: NationalLifeSyncStatus): string | null {
  if (!status.shouldPoll || !status.estimate) return null
  const { lowerMinutes, upperMinutes } = status.estimate
  return lowerMinutes === upperMinutes
    ? `Typically about ${lowerMinutes} min for the remaining areas`
    : `Typically about ${lowerMinutes}–${upperMinutes} min for the remaining areas`
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
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

function isCurrentPriorityPlan(status: NationalLifeSyncStatus): boolean {
  const coverageKeys = status.stageCoverage?.map((stage) => stage.gridKey) ?? []
  const knownPlans = [
    NATIONAL_LIFE_PRIORITY_GRID_KEYS,
    STRUCTURED_PRIORITY_GRID_KEYS,
    PERSONAL_PRIORITY_GRID_KEYS,
    PERSONAL_STRUCTURED_PRIORITY_GRID_KEYS,
  ]
  const expected = knownPlans.find((plan) => plan.length === status.total) ?? null
  if (!expected) return false
  // Older non-local status payloads may not include coverage. For current local
  // runs, require the same exact ordered plan used by run reuse.
  if (coverageKeys.length === 0) return true
  return coverageKeys.length === expected.length && coverageKeys.every(
    (gridKey, index) => gridKey === expected[index],
  )
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
        <KBotActivity
          state="idle"
          title="K-Bot is ready for the first sync"
          detail="Start it above. This panel will show each National Life area only as it is received and saved."
        />
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
  const currentPriorityPlan = isCurrentPriorityPlan(status)
  const historicalCompletedPlan = status.state === 'COMPLETED' && !currentPriorityPlan
  const lastSynced = formatMoment(status.completedAt)
  // Só depois do fim. No meio do run, "nada novo desta vez" ou "120 gravados"
  // seriam a mesma mentira do "concluído" eterno, apontada para o outro lado.
  const outcome = terminal ? outcomeLine(status, snapshotRecords) : null
  const discards = terminal ? discardLine(status, snapshotRecords) : null
  const estimate = estimateLine(status)
  const botState: KBotState = status.state === 'COMPLETED'
    ? 'success'
    : status.state === 'PAUSED' || status.state === 'PARTIAL'
      ? 'waiting'
      : status.state === 'FAILED'
        ? 'error'
        : active
          ? 'working'
          : 'idle'
  const botTitle = status.state === 'COMPLETED'
    ? currentPriorityPlan
      ? 'K-Bot finished updating your priority data'
      : 'K-Bot preserved your previous National Life sync'
    : status.state === 'PAUSED'
      ? 'K-Bot needs your National Life login'
      : terminal
        ? 'K-Bot saved the available areas'
        : 'K-Bot is updating your National Life data'
  const botDetail = status.state === 'PAUSED'
    ? 'Sign in once and the same task continues from its last saved checkpoint.'
    : active
      ? status.currentGridLabel
        ? `K-Bot is collecting ${status.currentGridLabel} from National Life. Everything already collected is safe.`
        : 'K-Bot is opening the next place it needs in National Life.'
      : status.state === 'COMPLETED'
        ? 'Verified data is ready throughout Keepr One.'
        : 'You can retry only the areas National Life did not return.'

  return (
    <section
      aria-label="National Life sync progress"
      aria-busy={active}
      className="mb-6 rounded-xl border border-border-steel bg-paper p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <KBotActivity
            state={botState}
            title={botTitle}
            detail={botDetail}
            estimate={estimate}
          />
          {terminal && lastSynced && (
            <p className="ml-[60px] mt-1 text-xs text-ink-muted">Last synced {lastSynced}</p>
          )}
          {historicalCompletedPlan && (
            <p className="ml-[60px] mt-1 max-w-2xl text-xs text-ink-muted">
              This was a broader portal run. Start a sync to refresh the current priority sources.
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="block font-mono text-sm font-semibold tabular-nums text-teal">
            {checked} of {status.total} portal areas checked
          </span>
          {status.estimate && (
            <span className="mt-1 block text-xs text-ink-muted">
              <span className="block">
                Based on {status.estimate.basisRuns} recent {status.estimate.basisRuns === 1 ? 'sync' : 'syncs'} from this account
              </span>
            </span>
          )}
        </div>
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

      {terminal && status.delta && (
        <div className="mt-5 rounded-xl border border-teal/20 bg-teal-pale/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">What changed in Keepr One</p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
              {status.delta.addedRecords.toLocaleString('en-US')} new to Keepr One
            </span>
            <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
              {status.delta.refreshedRecords.toLocaleString('en-US')} reconfirmed
            </span>
            {status.delta.newCommissionAmount !== null && (
              <span className="rounded-full bg-paper px-3 py-1.5 font-semibold text-ink shadow-sm">
                {money(status.delta.newCommissionAmount)} in newly received commission entries
              </span>
            )}
          </div>
        </div>
      )}

      {terminal && status.failed > 0 && (
        <button
          type="button"
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-full bg-rail-strong px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-rail"
          onClick={() => window.dispatchEvent(new Event(NATIONAL_LIFE_RETRY_REMAINING_EVENT))}
        >
          Retry remaining {status.failed === 1 ? 'source' : 'sources'}
        </button>
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
            {reused > 0 && (
              <p className="text-xs text-ink-muted">
                Reused areas were already verified in the previous attempt.
              </p>
            )}
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
                {stage.verifiedAt && (
                  <p className="mt-1 text-[10px] opacity-80">
                    Confirmed by National Life {formatMoment(stage.verifiedAt)}
                  </p>
                )}
                {stage.state === 'FAILED' && (
                  <p className="mt-1 text-[10px] font-semibold">Last attempt needs retry</p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-steel bg-panel/45 px-3 py-2 text-xs text-ink-muted">
            <span>
              {currentPriorityPlan ? 'Current plan' : 'Previous run plan'}: {plannedStructuredSources} structured
              {plannedSnapshotSources > 0 ? ` + ${plannedSnapshotSources} snapshot sources` : ''}
            </span>
            <span className="font-mono font-semibold tabular-nums text-ink">
              {PORTAL_COVERAGE.automatic} of {PORTAL_COVERAGE.required} known sources are operationally structured
            </span>
          </div>
        </div>
      )}

      {active && (
        <p className="mt-4 text-xs leading-5 text-ink-muted">
          Data is saved in batches as each area finishes. You can keep working anywhere in Keepr One while National Life is being read.
        </p>
      )}
    </section>
  )
}
