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
            message: 'Sua ilustração oficial está pronta.',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'Ver ilustração',
          })
        } else if (nextIllustration?.state === 'FAILED') {
          setNotice({
            message: 'Não consegui concluir esta ilustração. O que já foi salvo está seguro.',
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: 'Revisar ilustração',
          })
        }
      }
      if (previousSyncPolling.current && nextSync && !nextSync.shouldPoll) {
        setNotice({
          message: nextSync.state === 'COMPLETED'
            ? 'Tudo pronto. Seus dados da National Life estão atualizados.'
            : 'Atualizei parte dos seus dados. Algumas informações ainda precisam ser buscadas.',
          href: '/agent/integrations/national-life',
          action: 'Ver atualização',
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

  const activity = sync && illustration?.state === 'NEEDS_YOU'
    ? (
        <Link
          href={`/agent/illustrations/${illustration.id}`}
          aria-label={`National Life: sync ${sync.completed} de ${sync.total}; ilustração precisa de login`}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          Sync {sync.completed}/{sync.total} · Login para ilustração
        </Link>
      )
    : sync && illustration?.state === 'WORKING'
    ? (
        <Link
          href={`/agent/illustrations/${illustration.id}`}
          aria-label={`National Life: sync ${sync.completed} de ${sync.total}; ilustração em andamento`}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
          Sync {sync.completed}/{sync.total} · Ilustração
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
              Preparando ilustração
            </Link>
          )
        : illustration?.state === 'NEEDS_YOU'
          ? (
              <Link
                href={`/agent/illustrations/${illustration.id}`}
                className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
                Ilustração precisa de login
              </Link>
            )
          : null

  const browserConnectorState = extensionTarget === null ? 'missing' : connectorState

  const syncProgress = sync && sync.total > 0 ? sync.completed / sync.total : null
  const syncEstimate = sync?.estimate
    ? sync.estimate.lowerMinutes === sync.estimate.upperMinutes
      ? `Cerca de ${sync.estimate.lowerMinutes} min restantes`
      : `Cerca de ${sync.estimate.lowerMinutes}–${sync.estimate.upperMinutes} min restantes`
    : null
  const tasks: KBotTask[] = []
  if (sync) {
    tasks.push({
      id: 'sync',
      label: 'Atualizando seus dados',
      detail: `${sync.completed} de ${sync.total} áreas verificadas`,
      state: sync.state === 'PAUSED' ? 'waiting' : 'working',
      progress: syncProgress,
      estimate: syncEstimate,
    })
  }
  if (illustration?.state === 'WORKING') {
    tasks.push({
      id: 'illustration',
      label: 'Preparando sua ilustração',
      detail: 'A National Life está calculando os valores e preparando o PDF',
      state: 'working',
    })
  } else if (illustration?.state === 'NEEDS_YOU') {
    tasks.push({
      id: 'illustration',
      label: 'Preciso do seu login',
      detail: 'Entre na National Life para eu continuar sua ilustração',
      state: 'waiting',
    })
  }

  const kbot = (() => {
    // The integration page has its own richer K-Bot presence, including the
    // browser pairing state. Everywhere else the global shell follows the
    // durable sync and illustration activity returned by the server.
    if (pathname === '/agent/integrations/national-life') return null

    let botState: KBotState = 'idle'
    let title = 'Estou pronto quando você precisar'
    let detail = 'Posso atualizar seus dados ou preparar uma ilustração oficial.'
    let actionHref = '/agent/integrations/national-life'
    let actionLabel = 'Abrir K-Bot'
    let activityMode: KBotActivityMode = 'idle'

    if (notice) {
      botState = 'success'
      title = notice.message
      detail = 'Já organizei o resultado no Keepr One.'
      actionHref = notice.href
      actionLabel = notice.action
    } else if (sync?.state === 'PAUSED') {
      botState = 'waiting'
      title = 'Preciso que você entre na National Life'
      detail = 'Assim que o login estiver pronto, continuo de onde parei.'
      actionHref = '/agent/integrations/national-life'
      actionLabel = 'Continuar sync'
      activityMode = 'sync'
    } else if (sync && illustration?.state === 'NEEDS_YOU') {
      botState = 'waiting'
      title = 'O sync continua. Sua ilustração precisa de login.'
      detail = 'Estou atualizando seus dados enquanto aguardo você entrar na National Life.'
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'Continuar ilustração'
      activityMode = 'combined'
    } else if (sync && illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'Estou cuidando de duas tarefas'
      detail = `Já verifiquei ${sync.completed} de ${sync.total} áreas e também estou preparando sua ilustração.`
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'Ver atividades'
      activityMode = 'combined'
    } else if (sync) {
      botState = 'working'
      title = 'Estou atualizando seus dados da National Life'
      detail = `${sync.completed} de ${sync.total} áreas verificadas.`
      actionLabel = 'Ver atualização'
      activityMode = 'sync'
    } else if (illustration?.state === 'NEEDS_YOU' || state?.kind === 'NEEDS_YOU') {
      botState = 'waiting'
      title = 'Preciso que você entre na National Life'
      detail = 'Assim que o login estiver pronto, continuo de onde parei.'
      actionHref = illustration?.id
        ? `/agent/illustrations/${illustration.id}`
        : '/agent/integrations/national-life'
      actionLabel = 'Continuar'
      activityMode = illustration ? 'illustration' : 'sync'
    } else if (illustration?.state === 'WORKING') {
      botState = 'working'
      title = 'Estou preparando sua ilustração oficial'
      detail = 'A National Life está calculando os valores e preparando o PDF.'
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = 'Ver ilustração'
      activityMode = 'illustration'
    } else if (browserConnectorState === 'missing') {
      botState = 'error'
      title = 'K-Bot não está disponível neste navegador'
      detail = 'Instale ou recarregue a extensão para eu trabalhar com a National Life.'
      actionLabel = 'Conectar K-Bot'
    } else if (browserConnectorState === 'disconnected') {
      botState = 'error'
      title = 'K-Bot está desconectado'
      detail = 'Conecte este computador uma vez e eu acompanho você em todo o Keepr One.'
      actionLabel = 'Conectar K-Bot'
    } else if (browserConnectorState === 'checking') {
      title = 'Estou verificando este navegador'
      detail = 'Fico pronto em instantes.'
    } else if (state?.kind === 'WORKING') {
      botState = 'working'
      title = 'Estou organizando seus dados da National Life'
      detail = `${state.count} ${state.count === 1 ? 'item está' : 'itens estão'} a caminho.`
      actionLabel = 'Ver atividade'
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
            : null}
        tasks={tasks}
        announcement={notice?.message}
      />
    )
  })()

  if (!state && !illustration && !notice) return kbot

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
