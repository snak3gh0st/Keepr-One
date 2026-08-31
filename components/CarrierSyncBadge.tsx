'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  carrierSyncLabel,
  type CarrierSyncState,
} from '@/lib/national-life/carrier-sync-state'
import {
  KBotCornerPresence,
  type KBotActivityMode,
  type KBotState,
  type KBotTask,
} from '@/components/kbot/KBotAvatar'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'

type CompactSyncStatus = {
  state?: string
  completed: number
  total: number
  shouldPoll: boolean
  estimate?: {
    lowerMinutes: number
    upperMinutes: number
  } | null
}

type IllustrationActivity = {
  id: string
  state: 'WORKING' | 'NEEDS_YOU' | 'READY' | 'FAILED'
  updatedAt: string
}

type ApplicationActivity = {
  id: string
  caseId: string
  state: 'WORKING' | 'NEEDS_YOU' | 'READY' | 'FAILED'
  updatedAt: string
}

type BadgeResponse = {
  state?: CarrierSyncState | null
  sync?: CompactSyncStatus | null
  illustration?: IllustrationActivity | null
  application?: ApplicationActivity | null
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
  const [application, setApplication] = useState<ApplicationActivity | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [extensionTarget, setExtensionTarget] = useState<string | null | undefined>(undefined)
  const [connectorState, setConnectorState] = useState<BrowserConnectorState>('checking')
  const previousIllustrationState = useRef<IllustrationActivity['state'] | null>(null)
  const previousApplicationState = useRef<ApplicationActivity['state'] | null>(null)
  const previousSyncPolling = useRef(false)
  const loadedOnce = useRef(false)
  const pathname = usePathname()

  const applyBody = useCallback((body: BadgeResponse) => {
    const nextSync = body.sync ?? null
    const nextIllustration = body.illustration ?? null
    const nextApplication = body.application ?? null
    if (loadedOnce.current) {
      const previousIllustration = previousIllustrationState.current
      if (previousIllustration && ['WORKING', 'NEEDS_YOU'].includes(previousIllustration)) {
        if (nextIllustration?.state === 'READY') {
          setNotice({
            message: 'Your official illustration is ready.',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'View illustration',
          })
        } else if (nextIllustration?.state === 'FAILED') {
          setNotice({
            message: 'I could not finish this illustration. Everything already saved is safe.',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'Review illustration',
          })
        }
      }
      if (previousSyncPolling.current && nextSync && !nextSync.shouldPoll) {
        setNotice({
          message: nextSync.state === 'COMPLETED'
            ? 'All set. Your National Life data is up to date.'
            : 'I updated the available data. Some areas still need to be collected.',
          href: '/agent/integrations/national-life',
          action: 'View update',
        })
      }
      const previousApplication = previousApplicationState.current
      if (previousApplication && ['WORKING', 'NEEDS_YOU'].includes(previousApplication)) {
        if (nextApplication?.state === 'READY') {
          setNotice({
            message: 'The iGO draft is ready for your review.',
            href: `/agent/cases/${nextApplication.caseId}`,
            action: 'Review application',
          })
        } else if (nextApplication?.state === 'FAILED') {
          setNotice({
            message: 'I could not finish this Application draft. Your reviewed information is safe.',
            href: `/agent/cases/${nextApplication.caseId}`,
            action: 'Review application',
          })
        }
      }
    }
    loadedOnce.current = true
    previousIllustrationState.current = nextIllustration?.state ?? null
    previousApplicationState.current = nextApplication?.state ?? null
    previousSyncPolling.current = Boolean(nextSync?.shouldPoll)
    setState(body.state ?? null)
    setSync(nextSync?.shouldPoll ? nextSync : null)
    setIllustration(nextIllustration)
    setApplication(nextApplication)
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
        setApplication(null)
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

  const shouldPoll = Boolean(sync?.shouldPoll) || illustration?.state === 'WORKING' ||
    illustration?.state === 'NEEDS_YOU' || application?.state === 'WORKING' ||
    application?.state === 'NEEDS_YOU'

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

  const activity = sync && illustration?.state === 'NEEDS_YOU'
    ? (
        <Link
          href={`/agent/illustrations/${illustration.id}`}
          aria-label={`National Life: sync ${sync.completed} of ${sync.total}; illustration needs login`}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          Sync {sync.completed}/{sync.total} · Illustration needs login
        </Link>
      )
    : sync && illustration?.state === 'WORKING'
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
            Updating {sync.completed}/{sync.total}
          </span>
        )
      : illustration?.state === 'WORKING'
        ? (
            <Link
              href={`/agent/illustrations/${illustration.id}`}
              className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
              Preparing illustration
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

  const browserConnectorState = extensionTarget === null ? 'missing' : connectorState

  const syncProgress = sync && sync.total > 0 ? sync.completed / sync.total : null
  const syncEstimate = sync?.estimate
    ? sync.estimate.lowerMinutes === sync.estimate.upperMinutes
      ? `About ${sync.estimate.lowerMinutes} min remaining`
      : `About ${sync.estimate.lowerMinutes}–${sync.estimate.upperMinutes} min remaining`
    : null
  const tasks: KBotTask[] = []
  if (sync) {
    tasks.push({
      id: 'sync',
      label: 'Updating your data',
      detail: `${sync.completed} of ${sync.total} areas checked`,
      state: sync.state === 'PAUSED' ? 'waiting' : 'working',
      progress: syncProgress,
      estimate: syncEstimate,
    })
  }
  if (illustration?.state === 'WORKING') {
    tasks.push({
      id: 'illustration',
      label: 'Preparing your illustration',
      detail: 'National Life is calculating the values and preparing the PDF',
      state: 'working',
    })
  } else if (illustration?.state === 'NEEDS_YOU') {
    tasks.push({
      id: 'illustration',
      label: 'I need your login',
      detail: 'Sign in to National Life so I can continue your illustration',
      state: 'waiting',
    })
  }
  if (application?.state === 'WORKING') {
    tasks.push({
      id: 'application',
      label: 'Preparing your Application',
      detail: 'I am filling the reviewed information in iGO and checking what comes back',
      state: 'working',
    })
  } else if (application?.state === 'NEEDS_YOU') {
    tasks.push({
      id: 'application',
      label: 'Application needs your login',
      detail: 'Sign in to National Life so I can continue the same iGO draft',
      state: 'waiting',
    })
  }

  const kbot = (() => {
    // The integration page has its own richer K-Bot presence, including the
    // browser pairing state. Everywhere else the global shell follows the
    // durable sync and illustration activity returned by the server.
    if (pathname === '/agent/integrations/national-life') return null

    let botState: KBotState = 'idle'
    let title = 'I am ready when you need me'
    let detail = 'I can update your data or prepare an official illustration.'
    let actionHref = '/agent/integrations/national-life'
    let actionLabel = 'Open K-Bot'
    let activityMode: KBotActivityMode = 'idle'

    if (notice) {
      botState = 'success'
      title = notice.message
      detail = 'I organized the result in Keepr One.'
      actionHref = notice.href
      actionLabel = notice.action
    } else if (application?.state === 'NEEDS_YOU') {
      botState = 'waiting'
      title = sync || illustration?.state === 'WORKING'
        ? 'I am continuing the other work. Your Application needs your login.'
        : 'I need you to sign in to continue the Application'
      detail = 'The reviewed dossier is safe. After login, I continue the same iGO draft.'
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = 'Continue Application'
      activityMode = sync || illustration?.state === 'WORKING' ? 'combined' : 'application'
    } else if (application?.state === 'WORKING' && (sync || illustration?.state === 'WORKING')) {
      botState = 'working'
      title = 'I am handling more than one task for you'
      detail = 'Your National Life work is moving independently. Open the panel to see each step.'
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = 'View activities'
      activityMode = 'combined'
    } else if (application?.state === 'WORKING') {
      botState = 'working'
      title = 'I am preparing your Application in iGO'
      detail = 'I am filling the reviewed information and checking the carrier response.'
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = 'View Application'
      activityMode = 'application'
    } else if (sync?.state === 'PAUSED') {
      botState = 'waiting'
      title = 'I need you to sign in to National Life'
      detail = 'Once you are signed in, I will continue where I stopped.'
      actionHref = '/agent/integrations/national-life'
      actionLabel = 'Resume sync'
      activityMode = 'sync'
    } else if (sync && illustration?.state === 'NEEDS_YOU') {
      botState = 'waiting'
      title = 'Your sync is still running. The illustration needs your login.'
      detail = 'I am updating your data while I wait for you to sign in to National Life.'
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'Continue illustration'
      activityMode = 'combined'
    } else if (sync && illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'I am updating your data and preparing your illustration'
      detail = `I checked ${sync.completed} of ${sync.total} areas and the illustration is moving too.`
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'View activities'
      activityMode = 'combined'
    } else if (sync) {
      botState = 'working'
      title = 'I am updating your National Life data'
      detail = `${sync.completed} of ${sync.total} areas checked.`
      actionLabel = 'View update'
      activityMode = 'sync'
    } else if (illustration?.state === 'NEEDS_YOU' || state?.kind === 'NEEDS_YOU') {
      botState = 'waiting'
      title = 'I need you to sign in to National Life'
      detail = 'Once you are signed in, I will continue where I stopped.'
      actionHref = illustration?.id
        ? `/agent/illustrations/${illustration.id}`
        : '/agent/integrations/national-life'
      actionLabel = 'Continue'
      activityMode = illustration ? 'illustration' : 'sync'
    } else if (illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'National Life is calculating the values'
      detail = 'I am preparing the official PDF with the confirmed result.'
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'View illustration'
      activityMode = 'illustration'
    } else if (browserConnectorState === 'missing') {
      botState = 'error'
      title = 'K-Bot is not available in this browser'
      detail = 'Install or reload the extension so I can work with National Life.'
      actionLabel = 'Connect K-Bot'
    } else if (browserConnectorState === 'disconnected') {
      botState = 'error'
      title = 'K-Bot is disconnected'
      detail = 'Connect this computer once and I will stay with you throughout Keepr One.'
      actionLabel = 'Connect K-Bot'
    } else if (browserConnectorState === 'checking') {
      title = 'I am checking this browser'
      detail = 'I will be ready in a moment.'
    } else if (state?.kind === 'WORKING') {
      botState = 'working'
      title = 'I am organizing your National Life data'
      detail = `${state.count} ${state.count === 1 ? 'item is' : 'items are'} on the way.`
      actionLabel = 'View activity'
      activityMode = 'sync'
    }

    return (
      <KBotCornerPresence
        state={botState}
        title={title}
        detail={detail}
        actionHref={actionHref}
        actionLabel={actionLabel}
        activity={activityMode}
        progress={syncProgress}
        secondaryState={illustration?.state === 'WORKING'
          ? 'working'
          : illustration?.state === 'NEEDS_YOU'
            ? 'waiting'
            : application?.state === 'WORKING'
              ? 'working'
              : application?.state === 'NEEDS_YOU'
                ? 'waiting'
            : null}
        tasks={tasks}
        announcement={notice?.message}
      />
    )
  })()

  if (!state && !illustration && !application && !notice) return kbot

  if (activity) return <>{activity}{kbot}</>

  if (!state) return <>{activity}{kbot}</>

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
      {kbot}
    </>
  )
}
