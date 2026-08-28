'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'

type CompactSyncStatus = {
  state?: string
  completed: number
  total: number
  shouldPoll: boolean
}

type IllustrationActivity = {
  id: string
  state: 'WORKING' | 'NEEDS_YOU' | 'READY' | 'FAILED'
  updatedAt: string
}

type BadgeResponse = {
  state?: CarrierSyncState | null
  sync?: CompactSyncStatus | null
  illustration?: IllustrationActivity | null
}

type Notice = {
  message: string
  href: string
  action: string
}

/// The carrier activity center in the global shell. It stays quiet at rest,
/// polls only while a sync or illustration is actually moving, and preserves
/// both activities when they run at the same time. Terminal transitions become
/// short, useful notices; historical terminal records do not create a toast on
/// first load.
export function CarrierSyncBadge({ separated = false }: { separated?: boolean }) {
  const [state, setState] = useState<CarrierSyncState | null>(null)
  const [sync, setSync] = useState<CompactSyncStatus | null>(null)
  const [illustration, setIllustration] = useState<IllustrationActivity | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const previousIllustrationState = useRef<IllustrationActivity['state'] | null>(null)
  const previousSyncPolling = useRef(false)
  const loadedOnce = useRef(false)
  const pathname = usePathname()

  const applyBody = useCallback((body: BadgeResponse) => {
    const nextSync = body.sync ?? null
    const nextIllustration = body.illustration ?? null
    if (loadedOnce.current) {
      const previousIllustration = previousIllustrationState.current
      if (previousIllustration && ['WORKING', 'NEEDS_YOU'].includes(previousIllustration)) {
        if (nextIllustration?.state === 'READY') {
          setNotice({
            message: 'Official National Life PDF is ready',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'View illustration',
          })
        } else if (nextIllustration?.state === 'FAILED') {
          setNotice({
            message: 'National Life needs this illustration reviewed',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'Review illustration',
          })
        }
      }
      if (previousSyncPolling.current && nextSync && !nextSync.shouldPoll) {
        setNotice({
          message: nextSync.state === 'COMPLETED'
            ? 'National Life sync is complete'
            : 'National Life sync finished with sources to retry',
          href: '/agent/integrations/national-life',
          action: 'View sync',
        })
      }
    }
    loadedOnce.current = true
    previousIllustrationState.current = nextIllustration?.state ?? null
    previousSyncPolling.current = Boolean(nextSync?.shouldPoll)
    setState(body.state ?? null)
    setSync(nextSync?.shouldPoll ? nextSync : null)
    setIllustration(nextIllustration)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/agent/carrier-sync')
      .then((response) => (response.ok ? response.json() : { state: null, sync: null, illustration: null }))
      .then((body) => {
        if (!alive) return
        applyBody(body as BadgeResponse)
      })
      .catch(() => {
        if (!alive) return
        setState(null)
        setSync(null)
        setIllustration(null)
      })
    return () => {
      alive = false
    }
  }, [pathname, applyBody])

  const shouldPoll = Boolean(sync?.shouldPoll) || illustration?.state === 'WORKING' || illustration?.state === 'NEEDS_YOU'

  useEffect(() => {
    if (!shouldPoll) return
    let alive = true
    const timer = window.setInterval(() => {
      fetch('/api/agent/carrier-sync')
        .then((response) => (response.ok ? response.json() : { state: null, sync: null }))
        .then((body) => {
          if (!alive) return
          applyBody(body as BadgeResponse)
        })
        .catch(() => {
          // Keep the last compact progress during a transient status failure.
        })
    }, 1_500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [shouldPoll, applyBody])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (!state && !illustration && !notice) return null

  const activity = sync && illustration?.state === 'WORKING'
    ? (
        <Link
          href={`/agent/illustrations/${illustration.id}`}
          aria-label={`National Life: sync ${sync.completed} of ${sync.total}; illustration in progress`}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
          Sync {sync.completed}/{sync.total} · Illustration
        </Link>
      )
    : sync
      ? (
          <span className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-teal" />
            Atualizando {sync.completed}/{sync.total}
          </span>
        )
      : illustration?.state === 'WORKING'
        ? (
            <Link
              href={`/agent/illustrations/${illustration.id}`}
              className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
              Generating illustration
            </Link>
          )
        : illustration?.state === 'NEEDS_YOU'
          ? (
              <Link
                href={`/agent/illustrations/${illustration.id}`}
                className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
                Illustration needs login
              </Link>
            )
          : null

  const toast = notice ? (
    <span
      role="status"
      className="fixed right-4 top-20 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-teal/25 bg-paper px-4 py-3 text-sm text-ink shadow-[0_18px_48px_rgba(15,29,19,0.16)]"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-teal" aria-hidden="true" />
      <span>{notice.message}</span>
      <Link className="shrink-0 font-semibold text-teal-deep underline" href={notice.href}>{notice.action}</Link>
    </span>
  ) : null

  if (activity) return <>{activity}{toast}</>

  if (!state) return <>{activity}{toast}</>

  const label = carrierSyncLabel(state)
  const dot =
    state.kind === 'NEEDS_YOU'
      ? 'bg-gold'
      : state.kind === 'WORKING'
        ? 'bg-teal'
        : 'bg-success'

  if (state.kind === 'NEEDS_YOU') {
    return (
      <>
        {activity ?? (
          <Link
            href="/agent/integrations/national-life"
            role="button"
            className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {label}
          </Link>
        )}
        {toast}
      </>
    )
  }

  return (
    <>
      {activity ?? (
        <span className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
      )}
      {toast}
    </>
  )
}
