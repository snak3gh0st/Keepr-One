'use client'

import { useEffect, useState } from 'react'
import type { ForesightReadStatus } from '@/lib/national-life/foresight-run-service'
import { KBotActivity, type KBotState } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'

const POLL_MS = 1_500

export function NationalLifeForesightProgress({
  initialStatus,
}: {
  initialStatus: ForesightReadStatus | null
}) {
  const { copy } = useI18n()
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
    ? copy('lendo {completed} de {total} serviços', 'reading {completed} of {total} services', { completed: status.completedServices, total: status.totalServices })
    : copy('lendo {completed} de {total} casos', 'reading {completed} of {total} cases', { completed: status.inventoriedCases, total: status.totalCases })
  const botState: KBotState = paused ? 'waiting' : terminal ? 'success' : 'working'

  return (
    <section aria-label={copy('Progresso do Foresight', 'Foresight progress')} className="mb-6 rounded-2xl border border-border-steel bg-paper p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <KBotActivity
          state={botState}
          title={paused
            ? copy('O K-Bot precisa do seu login da National Life', 'K-Bot needs your National Life login')
            : terminal
              ? copy('O K-Bot terminou de ler o Foresight', 'K-Bot finished reading Foresight')
              : copy('O K-Bot está lendo o Foresight', 'K-Bot is reading Foresight')}
          detail={paused
            ? copy('Reconecte uma vez e esta mesma tarefa de inventário continuará.', 'Reconnect once and this same inventory job continues.')
            : `Foresight: ${progress}`}
          compact
        />
        <span className="font-mono text-sm font-semibold text-teal">{status.percent}%</span>
      </div>
      <progress aria-label={copy('Progresso da leitura do Foresight', 'Foresight reading progress')} className="mt-5 h-2 w-full accent-teal" max={100} value={status.percent} />
      {paused && <p className="mt-3 text-sm text-ink-muted">{copy('Nada foi alterado na seguradora.', 'Nothing was changed at the carrier.')}</p>}
    </section>
  )
}
