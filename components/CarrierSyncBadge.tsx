'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'
import { KBotCornerPresence, type KBotState } from '@/components/kbot/KBotAvatar'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'

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
  connector?: {
    enabled: boolean
    extensionTarget?: string | null
  } | null
}

type BrowserConnectorState = 'checking' | 'missing' | 'disconnected' | 'ready'

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
  const [extensionTarget, setExtensionTarget] = useState<string | null | undefined>(undefined)
  const [connectorState, setConnectorState] = useState<BrowserConnectorState>('checking')
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
    if ('connector' in body) {
      setExtensionTarget(body.connector?.enabled ? body.connector.extensionTarget ?? null : null)
    }
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

  useEffect(() => {
    if (!extensionTarget) return

    let alive = true
    const probe = () => {
      void sendConnectorMessage(extensionTarget, { type: 'GET_CONNECTOR_STATUS' })
        .then((response) => {
          if (!alive) return
          setConnectorState(response.device?.status === 'READY' ? 'ready' : 'disconnected')
        })
        .catch(() => {
          if (alive) setConnectorState('missing')
        })
    }
    const recheckWhenVisible = () => {
      if (document.visibilityState === 'visible') probe()
    }

    probe()
    window.addEventListener('focus', probe)
    document.addEventListener('visibilitychange', recheckWhenVisible)
    const timer = window.setInterval(probe, 10_000)
    return () => {
      alive = false
      window.removeEventListener('focus', probe)
      document.removeEventListener('visibilitychange', recheckWhenVisible)
      window.clearInterval(timer)
    }
  }, [extensionTarget])

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

  const browserConnectorState = extensionTarget === null ? 'missing' : connectorState

  const kbot = (() => {
    // The integration page has its own richer K-Bot presence, including the
    // browser pairing state. Everywhere else the global shell follows the
    // durable sync and illustration activity returned by the server.
    if (pathname === '/agent/integrations/national-life') return null

    let botState: KBotState = 'idle'
    let title = 'K-Bot is ready'
    let detail = 'Open K-Bot whenever you want to work with National Life.'
    let actionHref = '/agent/integrations/national-life'
    let actionLabel = 'Open K-Bot'

    if (notice) {
      botState = 'success'
      title = notice.message
      detail = 'The result is ready in Keepr One.'
      actionHref = notice.href
      actionLabel = notice.action
    } else if (illustration?.state === 'NEEDS_YOU' || state?.kind === 'NEEDS_YOU') {
      botState = 'waiting'
      title = 'K-Bot is waiting for you'
      detail = 'National Life needs your login before K-Bot can continue.'
      actionHref = illustration?.id
        ? `/agent/illustrations/${illustration.id}`
        : '/agent/integrations/national-life'
      actionLabel = 'Continue'
    } else if (sync && illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'K-Bot is handling two tasks'
      detail = `Sync ${sync.completed} of ${sync.total} and the official illustration are moving together.`
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'View activity'
    } else if (sync) {
      botState = 'working'
      title = 'K-Bot is syncing National Life'
      detail = `${sync.completed} of ${sync.total} portal areas checked.`
      actionLabel = 'View sync'
    } else if (illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'K-Bot is creating the official illustration'
      detail = 'National Life is calculating the values and preparing the PDF.'
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'View illustration'
    } else if (browserConnectorState === 'missing') {
      botState = 'error'
      title = 'K-Bot is not available in this browser'
      detail = 'Install or reload the K-Bot extension so it can work with National Life.'
      actionLabel = 'Connect K-Bot'
    } else if (browserConnectorState === 'disconnected') {
      botState = 'error'
      title = 'K-Bot is disconnected'
      detail = 'Connect this computer once and K-Bot will stay with you throughout Keepr One.'
      actionLabel = 'Connect K-Bot'
    } else if (browserConnectorState === 'checking') {
      title = 'K-Bot is checking this browser'
      detail = 'It will be ready in a moment.'
    } else if (state?.kind === 'WORKING') {
      botState = 'working'
      title = 'K-Bot is organizing your National Life data'
      detail = `${state.count} item${state.count === 1 ? '' : 's'} on the way.`
      actionLabel = 'View activity'
    }

    return (
      <KBotCornerPresence
        state={botState}
        title={title}
        detail={detail}
        actionHref={actionHref}
        actionLabel={actionLabel}
      />
    )
  })()

  if (!state && !illustration && !notice) return kbot

  if (activity) return <>{activity}{toast}{kbot}</>

  if (!state) return <>{activity}{toast}{kbot}</>

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
        {kbot}
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
      {kbot}
    </>
  )
}
