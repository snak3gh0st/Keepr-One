'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'

/// What the top bar says about the carrier.
///
/// Replaces a dot and the words "Operação conectada" that were hardcoded green
/// and read no state at all. A badge rather than a button: a permanent "Sync"
/// invites pressing, and pressing something that usually does nothing teaches
/// that it means nothing — so only the state that asks for something is
/// clickable.
export function CarrierSyncBadge() {
  const [state, setState] = useState<CarrierSyncState | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/agent/carrier-sync')
      .then((response) => (response.ok ? response.json() : { state: null }))
      .then((body) => alive && setState(body.state ?? null))
      .catch(() => alive && setState(null))
    return () => {
      alive = false
    }
  }, [])

  if (!state) return null

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
        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </Link>
    )
  }

  return (
    <span className="shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
