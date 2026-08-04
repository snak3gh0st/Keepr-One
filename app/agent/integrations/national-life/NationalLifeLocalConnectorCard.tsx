'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'

type ConnectorResponse = {
  ok: boolean
  error?: string
  status?: string
  deviceId?: string
  device?: { status?: string; deviceId?: string }
  sync?: { status?: string; errorCode?: string }
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

const stateCopy: Record<ConnectorState, string> = {
  idle: 'Pronto para conectar',
  checking: 'Verificando acesso neste navegador…',
  installing: 'Abrindo a instalação segura…',
  connecting: 'Conectando ao Keepr One…',
  'login-required': 'Entre no portal oficial para continuar.',
  syncing: 'Sincronizando seus dados…',
  success: 'Sincronização concluída.',
  error: 'Não foi possível conectar agora. Tente novamente.',
}

export function NationalLifeLocalConnectorCard({
  extensionId,
  storeUrl,
  baseUrl,
  remoteAvailable = false,
}: {
  extensionId: string
  storeUrl: string
  baseUrl: string
  remoteAvailable?: boolean
}) {
  const router = useRouter()
  const installedFlowStarted = useRef(false)
  const watchAbort = useRef(0)
  const [state, setState] = useState<ConnectorState>('idle')
  const [compatible, setCompatible] = useState(false)
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null)
  const busy = !['idle', 'success', 'error', 'login-required'].includes(state)

  useEffect(() => {
    setCompatible(browserSupportsConnector())
  }, [])

  async function watchSyncProgress(): Promise<void> {
    const token = ++watchAbort.current
    setState('syncing')
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (token !== watchAbort.current) return
      await sleep(attempt === 0 ? 750 : 1_000)
      if (token !== watchAbort.current) return
      const status = await sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' })
      const syncStatus = status.sync?.status
      if (status.device?.deviceId) setPairedDeviceId(status.device.deviceId)
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
        setState('error')
        return
      }
    }
    setState('error')
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
      label: 'Este computador',
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
    } catch {
      setState('error')
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
    setState('checking')
    void runInstalledFlowRef.current()
  }, [])

  useEffect(() => {
    if (!compatible || !extensionId) return
    void sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' })
      .then((status) => {
        if (status.device?.deviceId) setPairedDeviceId(status.device.deviceId)
        if (status.sync?.status === 'AUTH_REQUIRED') setState('login-required')
        if (status.sync?.status === 'COMPLETED') setState('success')
      })
      .catch(() => {})
  }, [compatible, extensionId])

  async function handlePrimaryAction() {
    if (!compatible) {
      setState('installing')
      openStore(storeUrl)
      return
    }
    setState('checking')
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
      if (error instanceof Error && error.message.startsWith('CONNECTOR_')) {
        setState('installing')
        openStore(storeUrl)
        return
      }
      setState('error')
    }
  }

  async function handleDisconnect() {
    if (!pairedDeviceId) return
    setState('checking')
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
      setState('error')
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
                KeeproneConnect · neste computador
              </p>
              <h2 id="local-connector-title" className="text-lg font-semibold tracking-[-0.02em] text-ink">
                Conectar e sincronizar
              </h2>
            </div>
          </div>
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            Via KeeproneConnect: você entra no portal oficial; a senha não passa pelo Keepr.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-full bg-teal-pale px-3 py-1.5 text-xs font-semibold text-teal-deep">
          1 clique
        </span>
      </div>

      <div className="flex flex-col gap-3 bg-panel/55 p-5 sm:flex-row sm:items-center sm:p-6">
        <Button type="button" variant="primary" disabled={busy} onClick={handlePrimaryAction}>
          {state === 'installing'
            ? 'Abrindo instalação…'
            : state === 'error'
              ? 'Tentar novamente'
              : state === 'login-required'
                ? 'Continuar'
                : busy
                  ? 'Conectando…'
                  : 'Conectar National Life'}
        </Button>
        {pairedDeviceId && !busy && (
          <Button type="button" variant="secondary" onClick={handleDisconnect}>
            Desconectar KeeproneConnect
          </Button>
        )}
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${state === 'error' ? 'text-danger' : state === 'success' ? 'text-success' : 'text-ink-muted'}`}
        >
          {compatible
            ? stateCopy[state]
            : 'Use Chrome ou Edge para conectar neste computador.'}
        </p>
        {remoteAvailable && !compatible && (
          <Link href="#national-life-remote" className="text-sm font-semibold text-teal underline-offset-4 hover:underline">
            Usar alternativa automática
          </Link>
        )}
      </div>
      {(state === 'success' || state === 'syncing') && (
        <div className="border-t border-border-steel px-5 py-4 sm:px-6">
          <Link
            href="/agent/integrations/national-life/data"
            className="text-sm font-semibold text-teal underline-offset-4 hover:underline"
          >
            Ver dados sincronizados
          </Link>
        </div>
      )}
    </section>
  )
}
