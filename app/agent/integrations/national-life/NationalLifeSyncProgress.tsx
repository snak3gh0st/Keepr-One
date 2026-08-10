'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

const POLL_INTERVAL_MS = 1_500
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
function outcomeLine(status: NationalLifeSyncStatus): string | null {
  if (status.writtenRecords === null) return null
  if (status.writtenRecords === 0) {
    return status.receivedRecords && status.receivedRecords > 0
      ? 'National Life returned records, but none of them could be saved. Try syncing again — if it repeats, contact support.'
      : 'National Life had nothing new to send this time.'
  }
  const plural = status.writtenRecords === 1 ? 'record' : 'records'
  return `${status.writtenRecords.toLocaleString('en-US')} ${plural} saved to Keepr One.`
}

function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
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
        className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6"
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
  const terminal = status.state === 'COMPLETED'
  const active = status.shouldPoll
  const lastSynced = formatMoment(status.completedAt)
  // Só depois do fim. No meio do run, "nada novo desta vez" ou "120 gravados"
  // seriam a mesma mentira do "concluído" eterno, apontada para o outro lado.
  const outcome = terminal ? outcomeLine(status) : null

  return (
    <section
      aria-label="National Life sync progress"
      aria-busy={active}
      className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6"
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
            {terminal ? 'Your National Life data' : 'Updating your National Life data'}
          </h2>
          {terminal && lastSynced && (
            <p className="mt-1 text-sm text-ink-muted">Last synced {lastSynced}</p>
          )}
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-teal">
          {status.completed} of {status.total} areas updated
        </span>
      </div>

      <progress
        aria-label="Update progress"
        className="mt-5 h-2 w-full overflow-hidden rounded-full accent-teal"
        max={status.total}
        value={status.completed}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        {status.currentGridLabel && !terminal ? (
          <span>Now reading and saving: {status.currentGridLabel}</span>
        ) : (
          <span>{outcome ?? `${status.percent}% done`}</span>
        )}
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

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border-steel bg-panel/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">Received from National Life</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.receivedRecords)}</p>
          <p className="mt-1 text-xs text-ink-muted">Rows delivered by the portal</p>
        </div>
        <div className="rounded-xl border border-teal/30 bg-teal-pale/45 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">Saved in Keepr One</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatCount(status.writtenRecords)}</p>
          <p className="mt-1 text-xs text-ink-muted">Rows written to your National Life data</p>
        </div>
      </div>

      {active && (
        <p className="mt-4 text-xs leading-5 text-ink-muted">
          Data is saved in batches as each area finishes. You can leave this page open while the portal is being read.
        </p>
      )}
    </section>
  )
}
