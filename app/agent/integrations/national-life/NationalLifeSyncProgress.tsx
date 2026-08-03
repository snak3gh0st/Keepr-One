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
  if (status.state === 'PAUSED') return 'Conecte a National Life para continuar.'
  if (status.state === 'PARTIAL' || status.state === 'FAILED') {
    return 'Algumas áreas foram atualizadas. Tente conectar novamente para continuar.'
  }
  return null
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

  return (
    <section
      aria-label="Progresso da sincronização National Life"
      className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Sincronização
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {terminal ? 'Dados atualizados' : 'Atualizando dados da seguradora'}
          </h2>
        </div>
        <span className="font-mono text-sm font-semibold text-teal">
          {status.completed} de {status.total} áreas atualizadas
        </span>
      </div>

      <progress
        aria-label="Progresso da atualização"
        className="mt-5 h-2 w-full overflow-hidden rounded-full accent-teal"
        max={status.total}
        value={status.completed}
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        {status.currentGridLabel && !terminal ? (
          <span>Agora: {status.currentGridLabel}</span>
        ) : (
          <span>{status.percent}% concluído</span>
        )}
        {message && (
          <span className="font-semibold text-gold">
            {message}
            {status.state === 'PAUSED' && (
              <Link className="ml-2 underline" href="/agent/integrations/national-life">
                Conectar
              </Link>
            )}
          </span>
        )}
      </div>
    </section>
  )
}
