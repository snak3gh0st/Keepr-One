'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'

const POLL_INTERVAL_MS = 1_500

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
  return `${status.writtenRecords.toLocaleString('en-US')} ${plural} saved.`
}

export function NationalLifeSyncProgress({
  initialStatus,
}: {
  initialStatus: NationalLifeSyncStatus | null
}) {
  const [status, setStatus] = useState<NationalLifeSyncStatus | null>(initialStatus)

  useEffect(() => {
    if (!status?.shouldPoll) return

    let alive = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent/integrations/national-life/sync', {
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as { run?: unknown }
        const next = safeStatus(body.run)
        if (alive && next) setStatus(next)
      } catch {
        // Keep the last known progress. A transient status request must not
        // turn a real bar into an empty state.
      }
    }

    const timer = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [status?.shouldPoll])

  if (!status) return null

  const message = friendlyState(status)
  const terminal = status.state === 'COMPLETED'
  const lastSynced = formatMoment(status.completedAt)
  const outcome = outcomeLine(status)

  return (
    <section
      aria-label="National Life sync progress"
      className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Sync
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {terminal ? 'Your National Life data' : 'Updating your National Life data'}
          </h2>
          {terminal && lastSynced && (
            <p className="mt-1 text-sm text-ink-muted">Last synced {lastSynced}</p>
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-teal">
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
          <span>Now: {status.currentGridLabel}</span>
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
    </section>
  )
}
