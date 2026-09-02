'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import {
  KBotAvatar,
  KBotCornerPresence,
  KBotTaskTrail,
  type KBotState,
  type KBotTask,
} from '@/components/kbot/KBotAvatar'
import {
  DISCONNECT_FAILED,
  connectorFailure,
} from '@/lib/national-life/local-connector/connector-failure'
import {
  NATIONAL_LIFE_RETRY_REMAINING_EVENT,
  NATIONAL_LIFE_SYNC_STARTED_EVENT,
} from './NationalLifeSyncProgress'
import {
  hasConnectorRuntime,
  sendConnectorMessage,
  type ConnectorResponse,
} from './NationalLifeConnectorClient'

type ConnectorState =
  | 'idle'
  | 'checking'
  | 'installing'
  | 'connecting'
  | 'login-required'
  | 'syncing'
  | 'slow'
  | 'partial'
  | 'success'
  | 'error'

type ConnectorPresence = 'checking' | 'installed' | 'missing'
type JourneyStepState = 'waiting' | 'active' | 'complete'

function ConnectionJourneyStep({
  label,
  detail,
  state,
}: {
  label: string
  detail: string
  state: JourneyStepState
}) {
  return (
    <li
      aria-current={state === 'active' ? 'step' : undefined}
      className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 transition-colors duration-500 sm:px-4 ${
        state === 'complete'
          ? 'border-teal/20 bg-teal-pale/55'
          : state === 'active'
            ? 'border-teal/35 bg-paper shadow-[0_12px_32px_-24px_rgba(0,93,82,0.55)]'
            : 'border-border-steel/70 bg-panel/35'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-all duration-500 ${
          state === 'complete'
            ? 'border-teal bg-teal text-paper'
            : state === 'active'
              ? 'animate-pulse border-teal bg-teal-pale text-teal-deep'
              : 'border-border-steel bg-paper text-ink-muted/55'
        }`}
      >
        {state === 'complete' ? '✓' : '•'}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-ink">{label}</span>
        <span className={`mt-0.5 block truncate text-[11px] ${state === 'active' ? 'text-teal-deep' : 'text-ink-muted'}`}>
          {detail}
        </span>
      </span>
    </li>
  )
}

function openStore(storeUrl: string) {
  const link = document.createElement('a')
  link.href = storeUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.click()
}

function browserSupportsConnector(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const userAgent = navigator.userAgent
  return /(?:Chrome|Chromium|Edg)\//.test(userAgent) || hasConnectorRuntime()
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function readDurableSync(runId: string) {
  try {
    const response = await fetch('/api/agent/integrations/national-life/sync', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      run?: { runId?: unknown; state?: unknown; safeErrorCode?: unknown } | null
    }
    if (!body.run || body.run.runId !== runId) return null
    return {
      state: typeof body.run.state === 'string' ? body.run.state : null,
      safeErrorCode: typeof body.run.safeErrorCode === 'string' ? body.run.safeErrorCode : null,
    }
  } catch {
    return null
  }
}

const storeStateCopy: Record<Exclude<ConnectorState, 'error'>, string> = {
  idle: 'K-Bot is ready for the next National Life task.',
  checking: 'K-Bot is checking this browser…',
  installing: 'Install K-Bot by KeeprOne from the Chrome Web Store, then return here. Keepr One will recognize it automatically.',
  connecting: 'K-Bot is connecting this computer to Keepr One…',
  'login-required': 'K-Bot needs you to sign in to National Life. The same task resumes automatically after login.',
  syncing: 'K-Bot is reading National Life and saving each completed area. You can keep working anywhere in Keepr One.',
  slow: 'K-Bot is waiting for National Life to finish the current area. Completed areas remain safely saved.',
  partial: 'K-Bot saved every available area. Run it again to collect only what National Life did not return.',
  success: 'K-Bot finished. Your National Life data is up to date.',
}

const pilotStateCopy: Record<Exclude<ConnectorState, 'error'>, string> = {
  ...storeStateCopy,
  installing:
    'Load the unpacked extension at chrome://extensions (developer mode), then click again.',
}

/// Quantas rodadas sem qualquer sinal de vida antes de suavizar a frase. O
/// relógio zera a cada progresso, então uma grade grande subindo lote a lote
/// nunca chega aqui — e mesmo chegando, o que se diz é "ainda rodando", não
/// "falhou": o watchdog não tem como saber que falhou. Passado o limite, a
/// consulta fica um pouco mais espaçada, mas não para — `uploads` só anda quando
/// um lote *termina* de subir, então um único PUT lento já parece parado, e a
/// margem aqui é o que evita chamar de demorado um sync saudável.
const STALL_LIMIT = 45
const ACTIVE_SYNC_STATUSES = new Set(['STARTING', 'NAVIGATING', 'EXTRACTING', 'UPLOADING'])

/// O que prova que o run andou desde a última consulta. `uploads` é o único
/// campo que se move dentro de uma única grade grande.
function progressSignature(sync: ConnectorResponse['sync']): string {
  return [sync?.status, sync?.stageIndex, sync?.uploads].join('|')
}

function humanizeSourceKey(value: string | undefined): string | null {
  if (!value) return null
  return value.toLowerCase().replace(/_/g, ' ')
}

function liveProgressCopy(
  state: ConnectorState,
  sync: ConnectorResponse['sync'],
): string | null {
  if ((state !== 'syncing' && state !== 'slow') || !sync) return null
  const stageNumber = typeof sync.stageIndex === 'number' ? sync.stageIndex + 1 : null
  const total = typeof sync.totalStages === 'number' ? sync.totalStages : null
  const source = humanizeSourceKey(sync.stageKey)
  const position = stageNumber && total ? `Area ${Math.min(stageNumber, total)} of ${total}` : null
  const action = source ? `Reading ${source}.` : 'Reading National Life.'
  const batches = typeof sync.uploads === 'number' && sync.uploads > 0
    ? ` ${sync.uploads.toLocaleString('en-US')} batches saved so far.`
    : ''
  const wait = state === 'slow'
    ? ' Waiting for the portal response; completed areas remain saved.'
    : ''
  return `${position ? `${position} · ` : ''}${action}${batches}${wait}`
}

export function NationalLifeLocalConnectorCard({
  extensionId,
  storeUrl = null,
  installMode = 'store',
  baseUrl,
  hideDuringActiveSync = false,
  latestRun = null,
}: {
  extensionId: string
  storeUrl?: string | null
  installMode?: 'pilot' | 'store'
  baseUrl: string
  hideDuringActiveSync?: boolean
  latestRun?: { runId: string; state: string } | null
}) {
  const router = useRouter()
  const installedFlowStarted = useRef(false)
  const watchAbort = useRef(0)
  const handlePrimaryActionRef = useRef<() => Promise<void>>(async () => {})
  const [state, setState] = useState<ConnectorState>('idle')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [compatible, setCompatible] = useState(false)
  const [connectorPresence, setConnectorPresence] = useState<ConnectorPresence>('checking')
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null)
  const [liveSync, setLiveSync] = useState<ConnectorResponse['sync']>(undefined)
  // The capability probe is asynchronous after hydration, but a user can click
  // before that microtask settles. Read the browser surface as a fallback so the
  // first click is not mistaken for an unsupported browser.
  const browserIsCompatible = compatible || browserSupportsConnector()
  // Keep the first client render identical to the server render. The synchronous
  // browser fallback above is for actions/effects only; using it in visible copy
  // would make Chrome render a different text node during hydration.
  const browserCapabilityResolved = compatible
  const recoverable =
    state === 'idle' ||
    state === 'success' ||
    state === 'partial' ||
    state === 'error' ||
    state === 'slow' ||
    state === 'installing'
  const busy = !recoverable
  const stateCopy = installMode === 'pilot' ? pilotStateCopy : storeStateCopy
  const failure = state === 'error' ? connectorFailure(errorCode) : null
  const loginComplete = ['syncing', 'slow', 'partial', 'success'].includes(state)
  const syncComplete = state === 'partial' || state === 'success'
  const syncActive = state === 'syncing' || state === 'slow'
  const disconnected = connectorPresence === 'installed' && !pairedDeviceId && state === 'idle'
  const extensionStepState: JourneyStepState = connectorPresence === 'installed' ? 'complete' : 'active'
  const loginStepState: JourneyStepState = loginComplete
    ? 'complete'
    : connectorPresence === 'installed'
      ? 'active'
      : 'waiting'
  const syncStepState: JourneyStepState = syncComplete ? 'complete' : syncActive ? 'active' : 'waiting'
  const extensionStepDetail = connectorPresence === 'installed'
    ? 'Installed'
    : connectorPresence === 'checking'
      ? 'Checking'
      : state === 'installing'
        ? 'Installing'
        : 'Install'
  const loginStepDetail = loginComplete
    ? 'Connected'
    : state === 'login-required'
      ? 'Waiting for sign-in'
      : connectorPresence === 'installed'
        ? state === 'connecting' || state === 'checking' ? 'Opening portal' : 'Ready'
        : 'Next'
  const syncStepDetail = syncComplete ? 'Up to date' : syncActive ? 'Syncing' : 'Waiting'
  const botState: KBotState = state === 'error' || disconnected || connectorPresence === 'missing'
    ? 'error'
    : state === 'login-required' || state === 'partial'
      ? 'waiting'
      : state === 'success'
        ? 'success'
        : busy || state === 'slow'
          ? 'working'
          : 'idle'
  const cornerCopy = (() => {
    if (connectorPresence === 'checking') {
      return { title: 'I am checking this browser', detail: 'I will be ready in a moment.' }
    }
    if (connectorPresence === 'missing') {
      return { title: 'Install K-Bot to begin', detail: 'Then I can work with National Life for you.' }
    }
    if (disconnected) {
      return { title: 'K-Bot is disconnected', detail: 'Connect this computer when you want me to work for you.' }
    }
    if (state === 'login-required') {
      return { title: 'I need you to sign in to National Life', detail: 'Once you are signed in, I will continue where I stopped.' }
    }
    if (state === 'syncing' || state === 'slow') {
      return { title: 'I am collecting your information', detail: 'I am already organizing it in Keepr One.' }
    }
    if (state === 'success') {
      return { title: 'All set. I organized everything for you.', detail: 'Your National Life information is up to date.' }
    }
    if (state === 'partial') {
      return { title: 'I saved the available areas', detail: 'You can ask me to collect the remaining areas.' }
    }
    if (state === 'error') {
      return { title: 'I could not finish this part', detail: 'Everything already saved is safe. Open the details to continue.' }
    }
    return pairedDeviceId
      ? { title: 'I am ready when you need me', detail: 'Start an update whenever you want.' }
      : { title: 'I am ready to connect', detail: 'Connect National Life to get started.' }
  })()
  const cornerProgress = liveSync?.totalStages && liveSync.totalStages > 0
    ? Math.min(1, Math.max(0, (liveSync.stageIndex ?? 0) / liveSync.totalStages))
    : null
  const cornerTasks: KBotTask[] = syncActive
    ? [{
        id: 'sync',
        label: 'Updating your data',
        detail: liveSync?.totalStages
          ? `${Math.min(liveSync.stageIndex ?? 0, liveSync.totalStages)} of ${liveSync.totalStages} areas checked`
          : 'Collecting your information from National Life',
        state: state === 'slow' ? 'waiting' : 'working',
        progress: cornerProgress,
      }]
    : []
  const syncTrailIndex = (() => {
    if (state === 'success') return 5
    if (state === 'partial') return 4
    switch (liveSync?.status) {
      case 'STARTING': return 0
      case 'NAVIGATING': return 1
      case 'EXTRACTING': return 2
      case 'UPLOADING': return 3
      case 'COMPLETED': return 5
      default: return state === 'syncing' || state === 'slow' ? 0 : -1
    }
  })()

  /// Toda tentativa nova começa sem o motivo da anterior. Sem isso a frase de um
  /// dispositivo revogado sobrevive por baixo do sucesso seguinte.
  function beginAttempt(next: ConnectorState) {
    setErrorCode(null)
    setState(next)
  }

  function fail(code: string | null) {
    setErrorCode(code)
    setState('error')
  }

  useEffect(() => {
    // Browser capability is only known after hydration. Defer the state write to
    // a microtask so the server-rendered card and the first client render stay
    // identical, while the lint rule does not mistake this external probe for a
    // synchronous render loop.
    let alive = true
    void Promise.resolve().then(() => {
      if (alive) setCompatible(browserSupportsConnector())
    })
    return () => {
      alive = false
    }
  }, [])

  const verifyInstallation = useCallback(async (): Promise<boolean> => {
    setConnectorPresence('checking')
    try {
      const status = await sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' })
      setConnectorPresence('installed')
      if (status.device?.deviceId) setPairedDeviceId(status.device.deviceId)
      return true
    } catch {
      setConnectorPresence('missing')
      return false
    }
  }, [extensionId])

  /// O laço de acompanhamento não termina sozinho: passado o limite ele só fica
  /// mais lento. Sem invalidar o token na desmontagem, sair da página por
  /// navegação de cliente deixaria uma consulta a cada 2s para sempre, chamando
  /// setState e router.refresh de um componente já morto — e cada remontagem
  /// cria um ref novo, então ir e voltar acumularia laços independentes.
  useEffect(() => {
    return () => {
      watchAbort.current += 1
    }
  }, [])

  async function watchSyncProgress(): Promise<void> {
    const token = ++watchAbort.current
    beginAttempt('syncing')
    let signature = ''
    let idle = 0
    for (;;) {
      if (token !== watchAbort.current) return
      await sleep(signature === '' ? 750 : idle >= STALL_LIMIT ? 2_000 : 1_000)
      if (token !== watchAbort.current) return
      const status = await sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' })
      const syncStatus = status.sync?.status
      setLiveSync(status.sync)
      setPairedDeviceId(status.device?.deviceId ?? null)
      const durable = status.sync?.runId ? await readDurableSync(status.sync.runId) : null
      if (durable?.state === 'COMPLETED') {
        setState('success')
        router.refresh()
        return
      }
      if (durable?.state === 'PARTIAL') {
        setState('partial')
        router.refresh()
        return
      }
      if (durable?.state === 'FAILED') {
        fail(durable.safeErrorCode ?? 'SYNC_INCOMPLETE')
        router.refresh()
        return
      }
      if (syncStatus === 'AUTH_REQUIRED') {
        signature = progressSignature(status.sync)
        idle = 0
        setState('login-required')
        continue
      }
      if (syncStatus === 'COMPLETED') {
        setState('success')
        router.refresh()
        return
      }
      if (syncStatus === 'PARTIAL') {
        setState('partial')
        router.refresh()
        return
      }
      if (syncStatus === 'ERROR') {
        fail(status.sync?.errorCode ?? null)
        router.refresh()
        return
      }
      const next = progressSignature(status.sync)
      if (next !== signature) {
        signature = next
        idle = 0
        setState('syncing')
        continue
      }
      idle += 1
      // Suavizar a frase, nunca inventar uma falha — e continuar olhando. Sair
      // do laço deixaria um run que termina enquanto o agente está longe preso
      // em "sincronizando" para sempre.
      if (idle >= STALL_LIMIT) setState('slow')
    }
  }
  const watchSyncProgressRef = useRef(watchSyncProgress)

  useEffect(() => {
    watchSyncProgressRef.current = watchSyncProgress
  })

  async function createPairingAndStart(): Promise<void> {
    setState('connecting')
    const pairingResponse = await fetch(
      '/api/agent/integrations/national-life/local-connector/pairings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: '{}',
      },
    )
    if (!pairingResponse.ok) throw new Error('PAIRING_FAILED')
    const pairing = (await pairingResponse.json()) as { code?: unknown }
    if (typeof pairing.code !== 'string') throw new Error('PAIRING_FAILED')

    const paired = await sendConnectorMessage(extensionId, {
      type: 'PAIR_CONNECTOR',
      code: pairing.code,
      label: 'This computer',
      baseUrl,
    })
    if (!paired.ok) throw new Error(paired.error ?? 'PAIRING_FAILED')
    if (typeof paired.deviceId === 'string') setPairedDeviceId(paired.deviceId)
    // A newly paired device must never inherit a failed plan from a previous
    // device. Starting with forceRefresh creates the current priority plan
    // (9 structured sources, or 13 when READ_PAGE is enabled) from scratch.
    await startSync(true)
  }

  async function startSync(forceRefresh = false): Promise<void> {
    const result = await sendConnectorMessage(extensionId, {
      type: 'START_NATIONAL_LIFE_SYNC',
      ...(forceRefresh ? { forceRefresh: true as const } : {}),
    })
    if (!result.ok) {
      if (result.error === 'CONNECTOR_NOT_PAIRED') {
        await createPairingAndStart()
        return
      }
      if (result.error === 'AUTH_REQUIRED') {
        setState('login-required')
        return
      }
      throw new Error(result.error ?? 'SYNC_FAILED')
    }
    window.dispatchEvent(new Event(NATIONAL_LIFE_SYNC_STARTED_EVENT))
    await watchSyncProgress()
  }

  async function handleFullRefresh(): Promise<void> {
    beginAttempt('checking')
    try {
      await startSync(true)
    } catch (error) {
      fail(error instanceof Error ? error.message : null)
    }
  }

  function notifySyncStarted() {
    window.dispatchEvent(new Event(NATIONAL_LIFE_SYNC_STARTED_EVENT))
  }

  async function runInstalledFlow() {
    try {
      await createPairingAndStart()
    } catch (error) {
      fail(error instanceof Error ? error.message : null)
    }
  }
  const runInstalledFlowRef = useRef(runInstalledFlow)

  useEffect(() => {
    runInstalledFlowRef.current = runInstalledFlow
  })

  async function continueAfterInstallation() {
    if (installedFlowStarted.current) return
    const installed = await verifyInstallation()
    if (!installed) {
      setState('installing')
      return
    }
    installedFlowStarted.current = true
    beginAttempt('connecting')
    await runInstalledFlowRef.current()
  }
  const continueAfterInstallationRef = useRef(continueAfterInstallation)

  useEffect(() => {
    continueAfterInstallationRef.current = continueAfterInstallation
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('connector') !== 'installed' || installedFlowStarted.current) return
    installedFlowStarted.current = true
    url.searchParams.delete('connector')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    beginAttempt('checking')
    void runInstalledFlowRef.current()
  }, [])

  useEffect(() => {
    if (!browserIsCompatible || !extensionId) return
    void sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' })
      .then(async (status) => {
        setConnectorPresence('installed')
        if (status.device?.deviceId) setPairedDeviceId(status.device.deviceId)
        if (
          status.sync?.runId &&
          status.sync.status &&
          ACTIVE_SYNC_STATUSES.has(status.sync.status)
        ) {
          // Returning to this page must observe the run already owned by the
          // extension, not render a second Sync button beside a live progress
          // panel. The watcher only reads status; it never starts another run.
          setLiveSync(status.sync)
          void watchSyncProgressRef.current()
          return
        }
        // The database wins over any transient extension state. In particular,
        // a server-timed-out run must not leave the card permanently claiming
        // that a login is still being processed.
        if (
          status.sync?.runId &&
          (status.sync.status === 'AUTH_REQUIRED' || status.sync.status === 'ERROR')
        ) {
          if (status.sync.runId === latestRun?.runId && latestRun.state === 'COMPLETED') {
            setErrorCode(null)
            setState('idle')
            return
          }
          if (status.sync.runId === latestRun?.runId && latestRun.state === 'PARTIAL') {
            setErrorCode(null)
            setState('partial')
            return
          }
          const durable = await readDurableSync(status.sync.runId)
          if (durable?.state === 'COMPLETED') {
            setErrorCode(null)
            setState('idle')
            return
          }
          if (durable?.state === 'PARTIAL') {
            setErrorCode(null)
            setState('partial')
            return
          }
          if (durable?.state === 'FAILED') {
            fail(durable.safeErrorCode ?? 'SYNC_INCOMPLETE')
            return
          }
        }
        if (status.sync?.status === 'AUTH_REQUIRED') setState('login-required')
        // Um ERROR gravado tem de sobreviver ao F5. Antes, recarregar a página
        // devolvia o cartão ao repouso como se nada tivesse acontecido.
        if (status.sync?.status === 'ERROR') fail(status.sync.errorCode ?? null)
        // COMPLETED não vira mais 'success' aqui: sem data, ele é grudento e a
        // página passaria a vida dizendo "concluído". Quem mostra a última
        // sincronização, datada, é o painel de progresso.
      })
      .catch(() => {
        setConnectorPresence('missing')
      })
  }, [browserIsCompatible, extensionId, latestRun?.runId, latestRun?.state])

  // The Store opens in a separate tab. When the agent returns, verify again so
  // the page recognizes the new installation without a reload or a technical
  // setup step.
  useEffect(() => {
    if (state !== 'installing' || !browserIsCompatible || !extensionId) return
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      void continueAfterInstallationRef.current()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [state, browserIsCompatible, extensionId, verifyInstallation])

  function promptInstall() {
    beginAttempt('installing')
    if (installMode === 'store' && storeUrl) {
      openStore(storeUrl)
    }
  }

  async function handlePrimaryAction() {
    if (state === 'installing') {
      await continueAfterInstallationRef.current()
      return
    }
    if (connectorPresence === 'missing') {
      promptInstall()
      return
    }
    if (!browserIsCompatible) {
      promptInstall()
      return
    }
    // O botão promete desconectar; disparar um sync aqui seria fazer o oposto
    // do que o agente pediu.
    if (failure?.action === 'disconnect') {
      await handleDisconnect()
      return
    }
    // "Start over" tem de recomeçar: um código de pareamento novo, emitido
    // agora. Passar pelo START reaproveitaria o caminho que acabou de falhar.
    if (failure?.action === 'pairing') {
      beginAttempt('connecting')
      try {
        await createPairingAndStart()
      } catch (error) {
        fail(error instanceof Error ? error.message : null)
      }
      return
    }
    // "Check again" tem de checar. Reenviar START faria a extensão renavegar a
    // aba e interromper justamente o sync que acabamos de dizer que segue vivo.
    // O try é obrigatório: watchSyncProgress deixa o cartão em 'syncing', que
    // não é recuperável, então uma rejeição não tratada aqui congelaria os dois
    // botões e não sobraria saída nenhuma.
    if (state === 'slow') {
      try {
        await watchSyncProgress()
      } catch (error) {
        fail(error instanceof Error ? error.message : null)
      }
      return
    }
    beginAttempt('checking')
    try {
      const result = await sendConnectorMessage(extensionId, {
        type: 'START_NATIONAL_LIFE_SYNC',
        // A 409 means the saved carrier cursor no longer describes the bytes
        // already accepted by the server. Retrying that cursor can only repeat
        // the same conflict. Start a new run; promoted rows remain deduplicated.
        ...(errorCode === 'IDEMPOTENCY_CONFLICT' ? { forceRefresh: true as const } : {}),
      })
      if (result.ok) {
        notifySyncStarted()
        await watchSyncProgress()
      } else if (result.error === 'CONNECTOR_NOT_PAIRED') {
        await createPairingAndStart()
      } else if (result.error === 'AUTH_REQUIRED') {
        setState('login-required')
      } else {
        throw new Error(result.error ?? 'SYNC_FAILED')
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : null
      if (code === 'CONNECTOR_UNAVAILABLE' || code === 'CONNECTOR_TIMEOUT') {
        promptInstall()
        return
      }
      fail(code)
    }
  }

  useEffect(() => {
    handlePrimaryActionRef.current = handlePrimaryAction
  })

  useEffect(() => {
    const retryRemaining = () => {
      if (busy) return
      void handlePrimaryActionRef.current()
    }
    window.addEventListener(NATIONAL_LIFE_RETRY_REMAINING_EVENT, retryRemaining)
    return () => window.removeEventListener(NATIONAL_LIFE_RETRY_REMAINING_EVENT, retryRemaining)
  }, [busy])

  async function handleDisconnect() {
    if (!pairedDeviceId) return
    beginAttempt('checking')
    try {
      const response = await fetch(
        `/api/agent/integrations/national-life/local-connector/devices/${encodeURIComponent(pairedDeviceId)}/revoke`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
        },
      )
      if (!response.ok) throw new Error('REVOKE_FAILED')
      try {
        await sendConnectorMessage(extensionId, { type: 'UNPAIR_CONNECTOR' })
      } catch {
        // Server revoke is enough; local wipe is best-effort.
      }
      setPairedDeviceId(null)
      setState('idle')
      router.refresh()
    } catch {
      fail(DISCONNECT_FAILED)
    }
  }

  return (
    <>
      <KBotCornerPresence
        state={botState}
        title={cornerCopy.title}
        detail={cornerCopy.detail}
        activity={syncActive ? 'sync' : 'idle'}
        progress={cornerProgress}
        tasks={cornerTasks}
      />
      <section
        aria-labelledby="local-connector-title"
        // NationalLifeSyncProgress is the single visible progress surface on
        // the integration page. Keep this controller mounted so its watcher,
        // recovery and completion transitions continue running, but remove the
        // duplicate card while that dedicated panel is active.
        hidden={hideDuringActiveSync && syncActive}
        className="overflow-hidden rounded-xl border border-border-steel bg-paper"
      >
      <div className="relative border-b border-border-steel bg-panel/45 p-5 sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <KBotAvatar state={botState} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-deep">
                K-Bot · on this computer
              </p>
              <h2 id="local-connector-title" className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">
                Put K-Bot to work
              </h2>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal-deep">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
            {installMode === 'pilot' ? 'Pilot' : 'One click'}
          </span>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-ink-muted">
          K-Bot operates the approved National Life steps in your browser session. By default, you sign in directly on National Life. If you opt in under Settings, Keepr One protects your credential for one K-Bot login attempt when that session expires.
          {installMode === 'pilot'
            ? ' In this pilot, load the unpacked extension using the ID configured for this environment.'
            : null}
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-ink-muted">
          On a private, trusted computer, selecting “Remember this device” on National Life can reduce repeated MFA prompts. National Life controls how long that trusted session lasts; Keepr One never bypasses MFA and pauses safely when sign-in is required again.
        </p>
        {pairedDeviceId && state === 'idle' && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-teal/25 bg-paper/80 px-3 py-2 text-sm font-semibold text-teal-deep">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-teal text-[11px] text-paper" aria-hidden="true">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                <path
                  d="m3.25 8.15 2.85 2.85 6.65-6.65"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </span>
            This computer is ready
          </div>
        )}
      </div>

      <div className="border-b border-border-steel bg-paper px-5 py-4 sm:px-7">
        <ol aria-label="Connection progress" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ConnectionJourneyStep label="K-Bot" detail={extensionStepDetail} state={extensionStepState} />
          <ConnectionJourneyStep label="National Life session" detail={loginStepDetail} state={loginStepState} />
          <ConnectionJourneyStep label="Verified data" detail={syncStepDetail} state={syncStepState} />
        </ol>
      </div>

      <div className="grid gap-5 bg-panel/45 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                state === 'error' ? 'bg-danger' : state === 'success' ? 'bg-success' : state === 'partial' ? 'bg-gold' : busy ? 'animate-pulse bg-teal' : 'bg-ink-muted/45'
              }`}
            />
            <p
              role="status"
              aria-live="polite"
              className={`text-sm leading-6 ${state === 'error' ? 'text-danger' : state === 'success' ? 'text-success' : state === 'partial' ? 'text-gold-ink' : 'text-ink-muted'}`}
            >
              {!browserCapabilityResolved
                ? 'Connecting on this computer needs Google Chrome or Microsoft Edge.'
                : connectorPresence === 'checking' && state === 'idle'
                  ? 'Checking whether K-Bot is installed…'
                  : connectorPresence === 'missing' && state !== 'installing'
                    ? 'K-Bot is not installed on this browser. Install the browser extension to start National Life tasks.'
                : state === 'error'
                  ? connectorFailure(errorCode).message
                  : state === 'idle' && pairedDeviceId
                    ? 'This computer is connected and ready to sync your National Life data.'
                    : liveProgressCopy(state, liveSync) ?? stateCopy[state]}
            </p>
            {syncTrailIndex >= 0 && (
              <div className="mt-3">
                <KBotTaskTrail
                  label="K-Bot sync steps"
                  currentIndex={syncTrailIndex}
                  steps={['Get ready', 'Open National Life', 'Collect information', 'Organize in Keepr One', 'Finished']}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" variant="primary" disabled={busy} onClick={handlePrimaryAction}>
            {state === 'installing'
              ? installMode === 'pilot'
                ? "I've installed it — connect"
                : 'Check installation'
              : connectorPresence === 'missing'
                ? 'Install K-Bot'
                : failure
                  ? failure.actionLabel
                : state === 'login-required'
                  ? 'Waiting for login…'
                  : state === 'slow'
                    ? 'Check again'
                    : busy
                      ? state === 'syncing'
                        ? 'Syncing…'
                        : 'Connecting…'
                      : state === 'success'
                        ? 'Sync again'
                        : state === 'partial'
                          ? 'Retry remaining areas'
                        : pairedDeviceId
                          ? 'Sync National Life'
                          : 'Connect National Life'}
          </Button>
          {pairedDeviceId && !busy && !failure && ['idle', 'success', 'partial'].includes(state) && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleFullRefresh}
              title="Read every portal area again instead of reusing verified areas"
            >
              Refresh all areas
            </Button>
          )}
          {pairedDeviceId && !busy && (
            <Button type="button" variant="secondary" onClick={handleDisconnect}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
      {failure?.action === 'update' && storeUrl && (
        <div className="border-t border-border-steel px-5 py-4 sm:px-6">
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
          >
            Open the extension page to update it
          </a>
        </div>
      )}
      {installMode === 'store' && storeUrl && connectorPresence === 'missing' && (
        <div className="border-t border-border-steel px-5 py-4 sm:px-6">
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
          >
            Download K-Bot by KeeprOne from the Chrome Web Store
          </a>
        </div>
      )}
      {(state === 'success' || state === 'partial' || state === 'syncing' || state === 'slow') && (
        <div className="border-t border-border-steel px-5 py-4 sm:px-6">
          <Link
            href="/agent/integrations/national-life/data"
            className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
          >
            View synced data
          </Link>
        </div>
      )}
      </section>
    </>
  )
}
