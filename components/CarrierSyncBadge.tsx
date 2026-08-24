'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'

type CompactSyncStatus = {
  completed: number
  total: number
  shouldPoll: boolean
}

/// What the top bar says about the carrier.
///
/// Replaces a dot and the words "Operação conectada" that were hardcoded green
/// and read no state at all. A badge rather than a button: a permanent "Sync"
/// invites pressing, and pressing something that usually does nothing teaches
/// that it means nothing — so only the state that asks for something is
/// clickable.
///
/// Refetches on every route change, not just on mount. `Shell` (the only place
/// this is rendered) never unmounts across a client-side navigation, so a
/// mount-only fetch would leave this reading "Precisa de você" long after the
/// agent followed it, connected, and the queue drained — until a hard reload.
/// This is still not polling: nothing here re-fires on a timer or while the
/// agent sits still on one screen, which is what the plan's "sem polling
/// contínuo, sem notificação" ruled out. It only re-fires on navigation.
export function CarrierSyncBadge({ separated = false }: { separated?: boolean }) {
  const [state, setState] = useState<CarrierSyncState | null>(null)
  const [sync, setSync] = useState<CompactSyncStatus | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    let alive = true
    fetch('/api/agent/carrier-sync')
      .then((response) => (response.ok ? response.json() : { state: null, sync: null }))
      .then((body) => {
        if (!alive) return
        setState(body.state ?? null)
        setSync(body.sync?.shouldPoll ? body.sync : null)
      })
      .catch(() => {
        if (!alive) return
        setState(null)
        setSync(null)
      })
    return () => {
      alive = false
    }
  }, [pathname])

  const syncPolling = sync?.shouldPoll ?? false

  useEffect(() => {
    if (!syncPolling) return
    let alive = true
    const timer = window.setInterval(() => {
      fetch('/api/agent/carrier-sync')
        .then((response) => (response.ok ? response.json() : { state: null, sync: null }))
        .then((body) => {
          if (!alive) return
          setState(body.state ?? null)
          setSync(body.sync?.shouldPoll ? body.sync : null)
        })
        .catch(() => {
          // Keep the last compact progress during a transient status failure.
        })
    }, 1_500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [syncPolling])

  if (!state) return null

  if (sync) {
    return (
      <span className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-teal" />
        Atualizando {sync.completed}/{sync.total}
      </span>
    )
  }

  const label = carrierSyncLabel(state)
  const dot =
    state.kind === 'NEEDS_YOU'
      ? 'bg-gold'
      : state.kind === 'WORKING'
        ? 'bg-teal'
        : 'bg-success'

  if (state.kind === 'NEEDS_YOU') {
    return (
      <Link
        href="/agent/integrations/national-life"
        role="button"
        className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </Link>
    )
  }

  return (
    <span className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
