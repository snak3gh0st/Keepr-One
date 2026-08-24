'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import {
  DISCONNECT_FAILED,
  connectorFailure,
} from '@/lib/national-life/local-connector/connector-failure'
import { NATIONAL_LIFE_SYNC_STARTED_EVENT } from './NationalLifeSyncProgress'

type ConnectorResponse = {
  ok: boolean
  error?: string
  status?: string
  deviceId?: string
  device?: { status?: string; deviceId?: string }
  sync?: {
    runId?: string
    status?: string
    errorCode?: string
    uploads?: number
    stageIndex?: number
    stageKey?: string
    totalStages?: number
  }
}

type ConnectorMessage =
  | { type: 'START_NATIONAL_LIFE_SYNC'; forceRefresh?: true }
  | { type: 'GET_CONNECTOR_STATUS' }
  | { type: 'UNPAIR_CONNECTOR' }
  | { type: 'PAIR_CONNECTOR'; code: string; label: string; baseUrl: string }

type ChromeRuntime = {
  lastError?: { message?: string }
  sendMessage: (
    extensionId: string,
    message: ConnectorMessage,
    callback: (response?: ConnectorResponse) => void,
  ) => void
}

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

function chromeRuntime(): ChromeRuntime | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as typeof window & { chrome?: { runtime?: ChromeRuntime } }).chrome
    ?.runtime
  return candidate && typeof candidate.sendMessage === 'function' ? candidate : null
}

export function sendConnectorMessage(
  extensionId: string,
  message: ConnectorMessage,
  timeoutMs = 5_000,
): Promise<ConnectorResponse> {
  return new Promise((resolve, reject) => {
    const runtime = chromeRuntime()
    if (!runtime) {
      reject(new Error('CONNECTOR_UNAVAILABLE'))
      return
    }
    let settled = false
    const timer = window.setTimeout(() => {
      settled = true
      reject(new Error('CONNECTOR_TIMEOUT'))
    }, timeoutMs)

    try {
      runtime.sendMessage(extensionId, message, (response) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (runtime.lastError || !response || typeof response.ok !== 'boolean') {
          reject(new Error('CONNECTOR_UNAVAILABLE'))
          return
        }
        resolve(response)
      })
    } catch {
      window.clearTimeout(timer)
      reject(new Error('CONNECTOR_UNAVAILABLE'))
    }
  })
}

function openStore(storeUrl: string) {
  const link = document.createElement('a')
  link.href = storeUrl
  link.target = '_self'
  link.rel = 'noopener noreferrer'
  link.click()
}

function browserSupportsConnector(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const userAgent = navigator.userAgent
  return /(?:Chrome|Chromium|Edg)\//.test(userAgent) || chromeRuntime() !== null
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
  idle: 'Ready to connect.',
  checking: 'Checking this browser…',
  installing: 'Opening the secure install page…',
  connecting: 'Connecting to Keepr One…',
  'login-required': 'Sign in to the National Life portal to continue. Your sync picks up from there on its own.',
  syncing: 'Reading National Life and saving each completed area to Keepr One.',
  slow: 'Waiting for National Life to finish the current area. Completed areas remain saved.',
  partial: 'The available areas were saved. Sync again to retry only the areas National Life did not return.',
  success: 'Your National Life data is up to date.',
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
}: {
  extensionId: string
  storeUrl?: string | null
  installMode?: 'pilot' | 'store'
  baseUrl: string
}) {
  const router = useRouter()
  const installedFlowStarted = useRef(false)
  const watchAbort = useRef(0)
  const [state, setState] = useState<ConnectorState>('idle')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [compatible, setCompatible] = useState(false)
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
    state === 'login-required' ||
    (installMode === 'pilot' && state === 'installing')
  const busy = !recoverable
  const stateCopy = installMode === 'pilot' ? pilotStateCopy : storeStateCopy
  const failure = state === 'error' ? connectorFailure(errorCode) : null

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
        setState('login-required')
        return
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
    await startSync()
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
      .then((status) => {
        if (status.device?.deviceId) setPairedDeviceId(status.device.deviceId)
        if (status.sync?.status === 'AUTH_REQUIRED') setState('login-required')
        // Um ERROR gravado tem de sobreviver ao F5. Antes, recarregar a página
        // devolvia o cartão ao repouso como se nada tivesse acontecido.
        if (status.sync?.status === 'ERROR') fail(status.sync.errorCode ?? null)
        // COMPLETED não vira mais 'success' aqui: sem data, ele é grudento e a
        // página passaria a vida dizendo "concluído". Quem mostra a última
        // sincronização, datada, é o painel de progresso.
      })
      .catch(() => {})
  }, [browserIsCompatible, extensionId])

  function promptInstall() {
    beginAttempt('installing')
    if (installMode === 'store' && storeUrl) {
      openStore(storeUrl)
    }
  }

  async function handlePrimaryAction() {
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
    <section
      aria-labelledby="local-connector-title"
      className="overflow-hidden rounded-xl border border-border-steel bg-paper"
    >
      <div className="relative border-b border-border-steel bg-panel/45 p-5 sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-12 w-12 place-items-center rounded-lg bg-rail-strong text-sm font-bold tracking-[0.12em] text-paper"
            >
              NL
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal-deep">
                KeeproneConnect · on this computer
              </p>
              <h2 id="local-connector-title" className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">
                Connect this computer
              </h2>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal-deep">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
            {installMode === 'pilot' ? 'Pilot' : 'One click'}
          </span>
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-6 text-ink-muted">
          Sign in on the official National Life portal. Your password never passes through Keepr One.
          {installMode === 'pilot'
            ? ' In this pilot, load the unpacked extension using the ID configured for this environment.'
            : null}
        </p>
        {pairedDeviceId && state === 'idle' && (
          <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-teal/25 bg-paper/80 px-3 py-2 text-sm font-semibold text-teal-deep">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-teal text-[11px] text-paper" aria-hidden="true">
              ✓
            </span>
            This computer is ready
          </div>
        )}
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
                : state === 'error'
                  ? connectorFailure(errorCode).message
                  : state === 'idle' && pairedDeviceId
                    ? 'This computer is connected and ready to sync your National Life data.'
                    : liveProgressCopy(state, liveSync) ?? stateCopy[state]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" variant="primary" disabled={busy} onClick={handlePrimaryAction}>
            {state === 'installing'
              ? installMode === 'pilot'
                ? "I've installed it — connect"
                : 'Opening the install page…'
              : failure
                ? failure.actionLabel
                : state === 'login-required'
                  ? 'Continue'
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
  )
}
