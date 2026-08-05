'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import {
  DISCONNECT_FAILED,
  connectorFailure,
} from '@/lib/national-life/local-connector/connector-failure'

type ConnectorResponse = {
  ok: boolean
  error?: string
  status?: string
  deviceId?: string
  device?: { status?: string; deviceId?: string }
  sync?: { status?: string; errorCode?: string; uploads?: number; stageIndex?: number }
}

type ConnectorMessage =
  | { type: 'START_NATIONAL_LIFE_SYNC' }
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

const storeStateCopy: Record<Exclude<ConnectorState, 'error'>, string> = {
  idle: 'Ready to connect.',
  checking: 'Checking this browser…',
  installing: 'Opening the secure install page…',
  connecting: 'Connecting to Keepr One…',
  'login-required': 'Sign in to the National Life portal to continue. Your sync picks up from there on its own.',
  syncing: 'Syncing your National Life data. You can leave this page open.',
  slow: 'Still syncing. A large book of business can take several minutes — you can leave this page open or come back later.',
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

export function NationalLifeLocalConnectorCard({
  extensionId,
  storeUrl = null,
  installMode = 'store',
  baseUrl,
  remoteAvailable = false,
}: {
  extensionId: string
  storeUrl?: string | null
  installMode?: 'pilot' | 'store'
  baseUrl: string
  remoteAvailable?: boolean
}) {
  const router = useRouter()
  const installedFlowStarted = useRef(false)
  const watchAbort = useRef(0)
  const [state, setState] = useState<ConnectorState>('idle')
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [compatible, setCompatible] = useState(false)
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null)
  const recoverable =
    state === 'idle' ||
    state === 'success' ||
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
    setCompatible(browserSupportsConnector())
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
      setPairedDeviceId(status.device?.deviceId ?? null)
      if (syncStatus === 'AUTH_REQUIRED') {
        setState('login-required')
        return
      }
      if (syncStatus === 'COMPLETED') {
        setState('success')
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

  async function startSync(): Promise<void> {
    const result = await sendConnectorMessage(extensionId, {
      type: 'START_NATIONAL_LIFE_SYNC',
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
    await watchSyncProgress()
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
    if (!compatible || !extensionId) return
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
  }, [compatible, extensionId])

  function promptInstall() {
    beginAttempt('installing')
    if (installMode === 'store' && storeUrl) {
      openStore(storeUrl)
    }
  }

  async function handlePrimaryAction() {
    if (!compatible) {
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
      className="overflow-hidden rounded-2xl border border-teal/35 bg-paper shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-col gap-5 border-b border-border-steel p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 place-items-center rounded-xl bg-teal-pale text-lg font-semibold text-teal-deep"
            >
              NL
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-deep">
                KeeproneConnect · on this computer
              </p>
              <h2 id="local-connector-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
                Connect and sync
              </h2>
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            You sign in on the official National Life portal. Your password never passes through
            Keepr One.
            {installMode === 'pilot'
              ? ' In this pilot, load the unpacked extension using the ID configured for this environment.'
              : null}
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal-deep">
          {installMode === 'pilot' ? 'Pilot' : 'One click'}
        </span>
      </div>

      <div className="flex flex-col gap-3 bg-panel/55 p-5 sm:flex-row sm:items-center sm:p-6">
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
                    ? 'Connecting…'
                    : state === 'success'
                      ? 'Sync again'
                      : 'Connect National Life'}
        </Button>
        {pairedDeviceId && !busy && (
          <Button type="button" variant="secondary" onClick={handleDisconnect}>
            Disconnect this computer
          </Button>
        )}
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${state === 'error' ? 'text-danger' : state === 'success' ? 'text-success' : 'text-ink-muted'}`}
        >
          {!compatible
            ? 'Connecting on this computer needs Google Chrome or Microsoft Edge.'
            : state === 'error'
              ? connectorFailure(errorCode).message
              : stateCopy[state]}
        </p>
        {remoteAvailable && !compatible && (
          <Link href="#national-life-remote" className="text-sm font-semibold text-teal underline-offset-4 hover:underline">
            Use the automatic option instead
          </Link>
        )}
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
      {(state === 'success' || state === 'syncing' || state === 'slow') && (
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
