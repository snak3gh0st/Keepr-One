'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type CarrierSyncState } from '@/lib/national-life/carrier-sync-state'
import {
  KBotCornerPresence,
  type KBotAction,
  type KBotActivityMode,
  type KBotAmbientMessage,
  type KBotState,
  type KBotTask,
} from '@/components/kbot/KBotAvatar'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { useI18n } from '@/components/i18n/LanguageProvider'

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
  state: 'WORKING' | 'NEEDS_YOU' | 'NEEDS_KBOT' | 'READY' | 'FAILED'
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
    autoLoginEnabled?: boolean
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
  const { copy } = useI18n()
  const quickActions = useMemo<KBotAction[]>(() => [
    {
      href: '/agent/integrations/national-life',
      badge: 'NL',
      label: copy('Sincronizar National Life', 'Sync National Life'),
      detail: copy('Atualize os dados da operadora neste navegador', 'Update your carrier data in this browser'),
    },
    {
      href: '/agent/illustrations/new',
      badge: 'PDF',
      label: copy('Criar ilustração', 'Create Illustration'),
      detail: copy('Prepare uma ilustração oficial de Term ou IUL', 'Prepare a Term or IUL official illustration'),
    },
    {
      href: '/agent/illustrations?intent=application',
      badge: 'iGO',
      label: copy('Criar aplicação no iGO', 'Create Application in iGO'),
      detail: copy('Escolha a ilustração oficial que iniciará a aplicação', 'Choose the official illustration that will start the Application'),
    },
  ], [copy])
  const ambientMessages = useMemo<KBotAmbientMessage[]>(() => [
    {
      id: 'sync-national-life',
      message: copy('Posso sincronizar seus dados da National Life para você.', 'I can sync your National Life data for you.'),
      href: quickActions[0].href,
      actionLabel: quickActions[0].label,
    },
    {
      id: 'official-illustration',
      message: copy('Quer que eu prepare uma ilustração oficial de Term ou IUL?', 'Would you like me to prepare an official Term or IUL illustration?'),
      href: quickActions[1].href,
      actionLabel: quickActions[1].label,
    },
    {
      id: 'igo-application',
      message: copy('Posso começar uma aplicação no iGO a partir de uma ilustração aprovada.', 'I can start an iGO application from an approved illustration.'),
      href: quickActions[2].href,
      actionLabel: quickActions[2].label,
    },
  ], [copy, quickActions])
  const [state, setState] = useState<CarrierSyncState | null>(null)
  const [sync, setSync] = useState<CompactSyncStatus | null>(null)
  const [illustration, setIllustration] = useState<IllustrationActivity | null>(null)
  const [application, setApplication] = useState<ApplicationActivity | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [extensionTarget, setExtensionTarget] = useState<string | null | undefined>(undefined)
  const [autoLoginEnabled, setAutoLoginEnabled] = useState(false)
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
            message: copy('Sua ilustração oficial está pronta.', 'Your official illustration is ready.'),
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: copy('Ver ilustração', 'View illustration'),
          })
        } else if (nextIllustration?.state === 'FAILED') {
          setNotice({
            message: copy('Não consegui concluir esta ilustração. Tudo que já foi salvo está seguro.', 'I could not finish this illustration. Everything already saved is safe.'),
            href: `/agent/illustrations/${nextIllustration.id}`,
            action: copy('Revisar ilustração', 'Review illustration'),
          })
        }
      }
      if (previousSyncPolling.current && nextSync && !nextSync.shouldPoll) {
        setNotice({
          message: nextSync.state === 'COMPLETED'
            ? copy('Tudo pronto. Seus dados da National Life estão atualizados.', 'All set. Your National Life data is up to date.')
            : copy('Atualizei os dados disponíveis. Algumas áreas ainda precisam ser coletadas.', 'I updated the available data. Some areas still need to be collected.'),
          href: '/agent/integrations/national-life',
          action: copy('Ver atualização', 'View update'),
        })
      }
      const previousApplication = previousApplicationState.current
      if (previousApplication && ['WORKING', 'NEEDS_YOU'].includes(previousApplication)) {
        if (nextApplication?.state === 'READY') {
          setNotice({
            message: copy('O rascunho do iGO está pronto para sua revisão.', 'The iGO draft is ready for your review.'),
            href: `/agent/cases/${nextApplication.caseId}`,
            action: copy('Revisar aplicação', 'Review application'),
          })
        } else if (nextApplication?.state === 'FAILED') {
          setNotice({
            message: copy('Não consegui concluir este rascunho de aplicação. Suas informações revisadas estão seguras.', 'I could not finish this Application draft. Your reviewed information is safe.'),
            href: `/agent/cases/${nextApplication.caseId}`,
            action: copy('Revisar aplicação', 'Review application'),
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
      setAutoLoginEnabled(Boolean(body.connector?.enabled && body.connector.autoLoginEnabled))
    }
  }, [copy])

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
    illustration?.state === 'NEEDS_YOU' || illustration?.state === 'NEEDS_KBOT' || application?.state === 'WORKING' ||
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
          aria-label={copy('National Life: sincronização {completed} de {total}; a ilustração precisa de login', 'National Life: sync {completed} of {total}; illustration needs login', { completed: sync.completed, total: sync.total })}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
          {copy('Sincronização {completed}/{total} · A ilustração precisa de login', 'Sync {completed}/{total} · Illustration needs login', { completed: sync.completed, total: sync.total })}
        </Link>
      )
    : sync && illustration?.state === 'WORKING'
    ? (
        <Link
          href={`/agent/illustrations/${illustration.id}`}
          aria-label={copy('National Life: sincronização {completed} de {total}; ilustração em andamento', 'National Life: sync {completed} of {total}; illustration in progress', { completed: sync.completed, total: sync.total })}
          className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
          {copy('Sincronização {completed}/{total} · Ilustração', 'Sync {completed}/{total} · Illustration', { completed: sync.completed, total: sync.total })}
        </Link>
      )
    : illustration?.state === 'NEEDS_KBOT'
      ? (
          <Link
            href="/agent/integrations/national-life"
            className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
            {copy('Reconecte o K-Bot para continuar', 'Reconnect K-Bot to continue')}
          </Link>
        )
    : sync
      ? (
          <span className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-teal" />
            {copy('Atualizando {completed}/{total}', 'Updating {completed}/{total}', { completed: sync.completed, total: sync.total })}
          </span>
        )
      : illustration?.state === 'WORKING'
        ? (
            <Link
              href={`/agent/illustrations/${illustration.id}`}
              className={`shell-connection inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-muted ${separated ? 'shell-carrier-separated' : ''}`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" aria-hidden="true" />
              {copy('Preparando ilustração', 'Preparing illustration')}
            </Link>
          )
        : illustration?.state === 'NEEDS_YOU'
          ? (
              <Link
                href={`/agent/illustrations/${illustration.id}`}
                className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-gold ${separated ? 'shell-carrier-separated' : ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
                {copy('A ilustração precisa de login', 'Illustration needs login')}
              </Link>
            )
          : null

  const browserConnectorState = extensionTarget === null ? 'missing' : connectorState

  const syncProgress = sync && sync.total > 0 ? sync.completed / sync.total : null
  const syncEstimate = sync?.estimate
    ? sync.estimate.lowerMinutes === sync.estimate.upperMinutes
      ? copy('Cerca de {minutes} min restantes', 'About {minutes} min remaining', { minutes: sync.estimate.lowerMinutes })
      : copy('Cerca de {lower}–{upper} min restantes', 'About {lower}–{upper} min remaining', { lower: sync.estimate.lowerMinutes, upper: sync.estimate.upperMinutes })
    : null
  const tasks: KBotTask[] = []
  if (sync) {
    tasks.push({
      id: 'sync',
      label: copy('Atualizando seus dados', 'Updating your data'),
      detail: copy('{completed} de {total} áreas verificadas', '{completed} of {total} areas checked', { completed: sync.completed, total: sync.total }),
      state: sync.state === 'PAUSED' ? 'waiting' : 'working',
      progress: syncProgress,
      estimate: syncEstimate,
    })
  }
  if (illustration?.state === 'WORKING') {
    tasks.push({
      id: 'illustration',
      label: copy('Preparando sua ilustração', 'Preparing your illustration'),
      detail: copy('A National Life está calculando os valores e preparando o PDF', 'National Life is calculating the values and preparing the PDF'),
      state: 'working',
    })
  } else if (illustration?.state === 'NEEDS_YOU') {
    tasks.push({
      id: 'illustration',
      label: copy('Preciso do seu login', 'I need your login'),
      detail: copy('Entre na National Life para eu continuar sua ilustração', 'Sign in to National Life so I can continue your illustration'),
      state: 'waiting',
    })
  } else if (illustration?.state === 'NEEDS_KBOT') {
    tasks.push({
      id: 'illustration',
      label: copy('Ilustração aguardando o K-Bot', 'Illustration waiting for K-Bot'),
      detail: copy('Reconecte este computador para o K-Bot abrir o Foresight e continuar a mesma solicitação.', 'Reconnect this computer so K-Bot can open Foresight and continue the same request.'),
      state: 'waiting',
    })
  }
  if (application?.state === 'WORKING') {
    tasks.push({
      id: 'application',
      label: copy('Preparando sua aplicação', 'Preparing your Application'),
      detail: copy('Estou preenchendo as informações revisadas no iGO e verificando o retorno', 'I am filling the reviewed information in iGO and checking what comes back'),
      state: 'working',
    })
  } else if (application?.state === 'NEEDS_YOU') {
    tasks.push({
      id: 'application',
      label: copy('A aplicação precisa do seu login', 'Application needs your login'),
      detail: copy('Entre na National Life para eu continuar o mesmo rascunho do iGO', 'Sign in to National Life so I can continue the same iGO draft'),
      state: 'waiting',
    })
  }

  const kbot = (() => {
    // The integration page has its own richer K-Bot presence, including the
    // browser pairing state. Everywhere else the global shell follows the
    // durable sync and illustration activity returned by the server.
    if (pathname === '/agent/integrations/national-life') return null

    let botState: KBotState = 'idle'
    let title = copy('Estou pronto quando você precisar', 'I am ready when you need me')
    let detail = copy('Posso atualizar seus dados ou preparar uma ilustração oficial.', 'I can update your data or prepare an official illustration.')
    let actionHref = '/agent/integrations/national-life'
    let actionLabel = copy('Abrir K-Bot', 'Open K-Bot')
    let activityMode: KBotActivityMode = 'idle'

    if (notice) {
      botState = 'success'
      title = notice.message
      detail = copy('Organizei o resultado na Keepr One.', 'I organized the result in Keepr One.')
      actionHref = notice.href
      actionLabel = notice.action
    } else if (application?.state === 'NEEDS_YOU') {
      botState = 'waiting'
      title = sync || illustration?.state === 'WORKING'
        ? copy('Estou continuando o outro trabalho. Sua aplicação precisa do seu login.', 'I am continuing the other work. Your Application needs your login.')
        : copy('Preciso que você entre para continuar a aplicação', 'I need you to sign in to continue the Application')
      detail = copy('O dossiê revisado está seguro. Depois do login, continuo o mesmo rascunho do iGO.', 'The reviewed dossier is safe. After login, I continue the same iGO draft.')
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = copy('Continuar aplicação', 'Continue Application')
      activityMode = sync || illustration?.state === 'WORKING' ? 'combined' : 'application'
    } else if (application?.state === 'WORKING' && (sync || illustration?.state === 'WORKING')) {
      botState = 'working'
      title = copy('Estou cuidando de mais de uma tarefa para você', 'I am handling more than one task for you')
      detail = copy('Seus trabalhos da National Life avançam de forma independente. Abra o painel para ver cada etapa.', 'Your National Life work is moving independently. Open the panel to see each step.')
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = copy('Ver atividades', 'View activities')
      activityMode = 'combined'
    } else if (application?.state === 'WORKING') {
      botState = 'working'
      title = copy('Estou preparando sua aplicação no iGO', 'I am preparing your Application in iGO')
      detail = copy('Estou preenchendo as informações revisadas e verificando a resposta da operadora.', 'I am filling the reviewed information and checking the carrier response.')
      actionHref = `/agent/cases/${application.caseId}`
      actionLabel = copy('Ver aplicação', 'View Application')
      activityMode = 'application'
    } else if (sync?.state === 'PAUSED') {
      botState = 'waiting'
      title = copy('Preciso que você entre na National Life', 'I need you to sign in to National Life')
      detail = copy('Assim que você entrar, continuarei de onde parei.', 'Once you are signed in, I will continue where I stopped.')
      actionHref = '/agent/integrations/national-life'
      actionLabel = copy('Retomar sincronização', 'Resume sync')
      activityMode = 'sync'
    } else if (sync && illustration?.state === 'NEEDS_YOU') {
      botState = 'waiting'
      title = copy('Sua sincronização continua. A ilustração precisa do seu login.', 'Your sync is still running. The illustration needs your login.')
      detail = copy('Estou atualizando seus dados enquanto aguardo seu login na National Life.', 'I am updating your data while I wait for you to sign in to National Life.')
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = copy('Continuar ilustração', 'Continue illustration')
      activityMode = 'combined'
    } else if (sync && illustration?.state === 'WORKING') {
      botState = 'working'
      title = copy('Estou atualizando seus dados e preparando sua ilustração', 'I am updating your data and preparing your illustration')
      detail = copy('Verifiquei {completed} de {total} áreas e a ilustração também está avançando.', 'I checked {completed} of {total} areas and the illustration is moving too.', { completed: sync.completed, total: sync.total })
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = copy('Ver atividades', 'View activities')
      activityMode = 'combined'
    } else if (sync) {
      botState = 'working'
      title = copy('Estou atualizando seus dados da National Life', 'I am updating your National Life data')
      detail = copy('{completed} de {total} áreas verificadas.', '{completed} of {total} areas checked.', { completed: sync.completed, total: sync.total })
      actionLabel = copy('Ver atualização', 'View update')
      activityMode = 'sync'
    } else if (illustration?.state === 'NEEDS_KBOT') {
      botState = 'waiting'
      title = copy('Reconecte o K-Bot para iniciar a ilustração', 'Reconnect K-Bot to start the illustration')
      detail = autoLoginEnabled
        ? copy('Seu login protegido da National Life está pronto. Reconecte o K-Bot neste computador para continuar a mesma solicitação.', 'Your protected National Life sign-in is ready. Reconnect K-Bot on this computer to continue the same request.')
        : copy('Reconecte o K-Bot neste computador para ele abrir o Foresight e continuar a mesma solicitação.', 'Reconnect K-Bot on this computer so it can open Foresight and continue the same request.')
      actionHref = '/agent/integrations/national-life'
      actionLabel = copy('Reconectar K-Bot', 'Reconnect K-Bot')
      activityMode = 'illustration'
    } else if (illustration?.state === 'NEEDS_YOU' || state?.kind === 'NEEDS_YOU') {
      botState = 'waiting'
      title = copy('Preciso que você entre na National Life', 'I need you to sign in to National Life')
      detail = copy('Assim que você entrar, continuarei de onde parei.', 'Once you are signed in, I will continue where I stopped.')
      actionHref = illustration?.id
        ? `/agent/illustrations/${illustration.id}`
        : '/agent/integrations/national-life'
      actionLabel = copy('Continuar', 'Continue')
      activityMode = illustration ? 'illustration' : 'sync'
    } else if (illustration?.state === 'WORKING') {
      botState = 'working'
      title = copy('A National Life está calculando os valores', 'National Life is calculating the values')
      detail = copy('Estou preparando o PDF oficial com o resultado confirmado.', 'I am preparing the official PDF with the confirmed result.')
      actionHref = `/agent/illustrations/${illustration.id}`
      actionLabel = copy('Ver ilustração', 'View illustration')
      activityMode = 'illustration'
    } else if (browserConnectorState === 'missing') {
      botState = 'error'
      title = copy('O K-Bot não está disponível neste navegador', 'K-Bot is not available in this browser')
      detail = copy('Instale ou recarregue a extensão para eu trabalhar com a National Life.', 'Install or reload the extension so I can work with National Life.')
      actionLabel = copy('Conectar K-Bot', 'Connect K-Bot')
    } else if (browserConnectorState === 'disconnected') {
      if (autoLoginEnabled) {
        botState = 'waiting'
        title = copy('O K-Bot precisa que este computador seja reconectado', 'K-Bot needs this computer reconnected')
        detail = copy('Seu login protegido da National Life está pronto. Reconecte o K-Bot para usá-lo quando a operadora solicitar sua entrada.', 'Your protected National Life sign-in is ready. Reconnect K-Bot to use it when the carrier asks you to sign in.')
        actionLabel = copy('Reconectar K-Bot', 'Reconnect K-Bot')
      } else {
        botState = 'error'
        title = copy('O K-Bot está desconectado', 'K-Bot is disconnected')
        detail = copy('Conecte este computador uma vez e permanecerei com você em toda a Keepr One.', 'Connect this computer once and I will stay with you throughout Keepr One.')
        actionLabel = copy('Conectar K-Bot', 'Connect K-Bot')
      }
    } else if (browserConnectorState === 'checking') {
      title = copy('Estou verificando este navegador', 'I am checking this browser')
      detail = copy('Estarei pronto em instantes.', 'I will be ready in a moment.')
    } else if (state?.kind === 'WORKING') {
      botState = 'working'
      title = copy('Estou organizando seus dados da National Life', 'I am organizing your National Life data')
      detail = state.count === 1
        ? copy('1 item está a caminho.', '1 item is on the way.')
        : copy('{count} itens estão a caminho.', '{count} items are on the way.', { count: state.count })
      actionLabel = copy('Ver atividade', 'View activity')
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
        quickActions={quickActions}
        announcement={notice?.message}
        ambientMessages={ambientMessages}
      />
    )
  })()

  if (!state && !illustration && !application && !notice) return kbot

  if (activity) return <>{activity}{kbot}</>

  if (!state) return <>{activity}{kbot}</>

  const label = state.kind === 'WORKING'
    ? copy('{count} a caminho', '{count} on the way', { count: state.count })
    : state.kind === 'NEEDS_YOU'
      ? copy('Precisa de você', 'Needs you')
      : copy('Atualizado', 'Up to date')
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
