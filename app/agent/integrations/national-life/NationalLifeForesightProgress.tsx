'use client'

import { useEffect, useState } from 'react'
import type { ForesightReadStatus } from '@/lib/national-life/foresight-run-service'

const POLL_MS = 1_500

export function NationalLifeForesightProgress({
  initialStatus,
}: {
  initialStatus: ForesightReadStatus | null
}) {
  const [status, setStatus] = useState(initialStatus)

  useEffect(() => {
    if (!status?.shouldPoll) return
    let alive = true
    const refresh = async () => {
      try {
        const response = await fetch('/api/agent/integrations/national-life/foresight', { cache: 'no-store' })
        if (!response.ok) return
        const body = (await response.json()) as { run?: ForesightReadStatus | null }
        if (alive) setStatus(body.run ?? null)
      } catch {
        // Preserve the last truthful state through a transient status failure.
      }
    }
    const timer = window.setInterval(refresh, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [status?.shouldPoll])

  if (!status) return null
  const paused = status.state === 'PAUSED'
  const terminal = !status.shouldPoll
  const progress = status.totalServices > 0
    ? `reading ${status.completedServices} of ${status.totalServices} services`
    : `reading ${status.inventoriedCases} of ${status.totalCases} cases`

  return (
    <section aria-label="Foresight progress" className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Foresight</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {paused ? 'Needs your attention' : terminal ? 'Finished reading' : 'Reading your carrier data'}
          </h2>
        </div>
        <span className="font-mono text-sm font-semibold text-teal">{status.percent}%</span>
      </div>
      <progress aria-label="Foresight reading progress" className="mt-5 h-2 w-full accent-teal" max={100} value={status.percent} />
      <p className="mt-3 text-sm text-ink-muted">
        {paused ? 'Reconnect to National Life to keep going. Nothing was changed at the carrier.' : `Foresight: ${progress}`}
      </p>
    </section>
  )
}
