// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))

import {
  NATIONAL_LIFE_RETRY_REMAINING_EVENT,
  NATIONAL_LIFE_SYNC_STARTED_EVENT,
} from './NationalLifeSyncProgress'
import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const storeUrl = `https://chromewebstore.google.com/detail/keeproneconnect/${extensionId}`
const baseUrl = 'https://app.keeprone.com'

type RuntimeCallback = (response?: Record<string, unknown>) => void

function installChromeMock(
  handler: (
    message: { type: string; forceRefresh?: true },
    callback: RuntimeCallback,
  ) => void,
) {
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        sendMessage: (
          _id: string,
          message: { type: string; forceRefresh?: true },
          callback: RuntimeCallback,
        ) =>
          handler(message, callback),
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/agent/integrations/national-life')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'chrome')
})

describe('NationalLifeLocalConnectorCard', () => {
  it('opens the official store when the connector is absent', async () => {
    installChromeMock((_message, callback) => callback())
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    expect(clicked).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Install K-Bot by KeeprOne from the Chrome Web Store')
  })

  it('detects a missing connector and links the official Chrome Web Store before sync', async () => {
    installChromeMock((_message, callback) => callback())

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('is not installed on this browser')
    expect(screen.getByRole('button', { name: 'Install K-Bot' })).toBeEnabled()
    expect(screen.getByRole('link', { name: /Download K-Bot/i })).toHaveAttribute(
      'href',
      storeUrl,
    )
    const progress = screen.getByRole('list', { name: 'Connection progress' })
    expect(within(progress).getByText('K-Bot')).toBeInTheDocument()
    expect(within(progress).getByText('Install')).toBeInTheDocument()
    expect(within(progress).getByText('National Life session')).toBeInTheDocument()
    expect(within(progress).getByText('Verified data')).toBeInTheDocument()
    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveTextContent('Install K-Bot to begin')
    expect(presence.querySelector('[data-kbot-character="true"]')).toHaveAttribute(
      'data-expression',
      'sad',
    )
  })

  it('shows K-Bot sad when the extension is installed but this computer is disconnected', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({ ok: true, device: { status: 'UNPAIRED' }, sync: { status: 'IDLE' } })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const presence = await screen.findByLabelText('K-Bot status')
    await waitFor(() => expect(presence).toHaveTextContent('K-Bot is disconnected'))
    expect(presence.querySelector('[data-kbot-character="true"]')).toHaveAttribute(
      'data-expression',
      'sad',
    )
  })

  it('pairs and starts sync automatically when the agent returns from the Store', async () => {
    let installed = false
    let installedChecks = 0
    const messages: string[] = []
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'NL-pair-after-store-install' }), { status: 201 }),
    )
    installChromeMock((message, callback) => {
      messages.push(message.type)
      if (!installed) {
        callback()
        return
      }
      if (message.type === 'GET_CONNECTOR_STATUS') {
        installedChecks += 1
        callback({
          ok: true,
          device: { status: installedChecks > 1 ? 'READY' : 'UNPAIRED', deviceId: installedChecks > 1 ? 'device-1' : undefined },
          sync: { status: installedChecks > 1 ? 'COMPLETED' : 'IDLE' },
        })
        return
      }
      callback({ ok: true, deviceId: 'device-1' })
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    await screen.findByRole('button', { name: 'Install K-Bot' })
    await userEvent.click(screen.getByRole('button', { name: 'Install K-Bot' }))
    installed = true
    window.dispatchEvent(new Event('focus'))

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('up to date'),
      { timeout: 3_000 },
    )
    expect(messages).toContain('PAIR_CONNECTOR')
    expect(messages).toContain('START_NATIONAL_LIFE_SYNC')
    expect(screen.queryByRole('link', { name: /Download K-Bot/i })).not.toBeInTheDocument()
  })

  it('guides unpacked install in pilot mode without opening a store URL', async () => {
    installChromeMock((_message, callback) => callback())
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={null}
        installMode="pilot"
        baseUrl={baseUrl}
      />,
    )
    expect(screen.getByText('Pilot')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    expect(clicked).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('chrome://extensions')
    expect(screen.getByRole('button', { name: "I've installed it — connect" })).toBeEnabled()
  })

  it('auto-pairs after installation without exposing the pairing code', async () => {
    window.history.replaceState({}, '', '/agent/integrations/national-life?connector=installed')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'NL-super-secret-pairing-code' }), { status: 201 }),
    )
    const messages: string[] = []
    const refreshModes: Array<true | undefined> = []
    installChromeMock((message, callback) => {
      messages.push(message.type)
      if (message.type === 'START_NATIONAL_LIFE_SYNC') {
        refreshModes.push(message.forceRefresh)
      }
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'COMPLETED' },
        })
        return
      }
      callback({ ok: true, deviceId: 'device-1' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    await waitFor(() =>
      expect(messages).toEqual(
        expect.arrayContaining(['PAIR_CONNECTOR', 'START_NATIONAL_LIFE_SYNC', 'GET_CONNECTOR_STATUS']),
      ),
    )
    expect(document.body).not.toHaveTextContent('NL-super-secret-pairing-code')
    expect(refreshModes).toEqual([true])
    expect(window.location.search).toBe('')
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('starts sync and waits for completion via connector status', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'COMPLETED' },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    expect(fetch).not.toHaveBeenCalled()
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('up to date'),
      { timeout: 3_000 },
    )
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('stops showing sync when the authoritative server run has completed', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: { runId: 'run-server', state: 'COMPLETED', safeErrorCode: null },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { runId: 'run-server', status: 'UPLOADING' },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('up to date'),
      { timeout: 3_000 },
    )
    expect(fetch).toHaveBeenCalledWith(
      '/api/agent/integrations/national-life/sync',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('offers a focused retry when the run finishes with isolated source failures', async () => {
    const messages: string[] = []
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: { runId: 'run-partial', state: 'PARTIAL', safeErrorCode: 'SOURCE_PARTIAL_FAILURE' },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
      messages.push(message.type)
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { runId: 'run-partial', status: 'COMPLETED' },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /National Life/ }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('saved every available area')
    })
    expect(screen.getByRole('button', { name: 'Retry remaining areas' })).toBeEnabled()
    expect(screen.getByRole('status')).not.toHaveTextContent('stopped')

    await act(async () => {
      window.dispatchEvent(new Event(NATIONAL_LIFE_RETRY_REMAINING_EVENT))
    })
    await waitFor(() => {
      expect(messages.filter((type) => type === 'START_NATIONAL_LIFE_SYNC')).toHaveLength(2)
    })
  })

  it('shows a sync action when an existing paired computer is detected', async () => {
    let started = false
    const messages: string[] = []
    const refreshModes: Array<true | undefined> = []
    const syncStarted = vi.fn()
    window.addEventListener(NATIONAL_LIFE_SYNC_STARTED_EVENT, syncStarted)
    installChromeMock((message, callback) => {
      messages.push(message.type)
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: started ? 'COMPLETED' : 'IDLE' },
        })
        return
      }
      if (message.type === 'START_NATIONAL_LIFE_SYNC') {
        refreshModes.push(message.forceRefresh)
        started = true
        callback({ ok: true })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sync National Life' })).toBeEnabled(),
    )
    expect(screen.getByRole('status')).toHaveTextContent('connected and ready to sync')

    await userEvent.click(screen.getByRole('button', { name: 'Sync National Life' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('up to date'))
    expect(messages).toContain('START_NATIONAL_LIFE_SYNC')
    expect(syncStarted).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Refresh all areas' }))
    await waitFor(() => expect(refreshModes).toEqual([undefined, true]))
  })

  it('reattaches to an active background run when the agent returns to the page', async () => {
    let checks = 0
    installChromeMock((message, callback) => {
      if (message.type !== 'GET_CONNECTOR_STATUS') {
        callback({ ok: true })
        return
      }
      checks += 1
      callback({
        ok: true,
        device: { status: 'READY', deviceId: 'device-1' },
        sync: checks === 1
          ? {
              runId: 'run-background',
              status: 'UPLOADING',
              stageIndex: 2,
              stageKey: 'INFORCE_CLIENTS',
              totalStages: 13,
              uploads: 6,
            }
          : { runId: 'run-background', status: 'COMPLETED' },
      })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
        hideDuringActiveSync
      />,
    )

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Put K-Bot to work' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('K-Bot status')).toHaveTextContent('I am collecting your information')
    })
    expect(screen.getByLabelText('K-Bot status')).toHaveClass('md:bottom-4', 'md:right-5')
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('up to date'),
      { timeout: 3_000 },
    )
  })

  it('keeps observing and completes automatically after the National Life login', async () => {
    let started = false
    let checksAfterStart = 0
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        const status = !started
          ? 'IDLE'
          : checksAfterStart++ === 0
            ? 'AUTH_REQUIRED'
            : 'COMPLETED'
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status },
        })
        return
      }
      started = true
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('up to date')
    }, { timeout: 4_000 })
    expect(checksAfterStart).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Connection progress' })).getByText('Up to date'),
    ).toBeInTheDocument()
  })

  it('shows a recoverable friendly error', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({ ok: true, device: { status: 'READY' }, sync: { status: 'IDLE' } })
        return
      }
      callback({ ok: false, error: 'PORTAL_FAILED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    expect(await screen.findByRole('status')).toHaveTextContent('try again')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('keeps a failure visible after the agent reloads the page', async () => {
    // O motivo fica gravado na extensão. Antes, o F5 devolvia o cartão ao
    // repouso: o agente recarregava e o problema simplesmente sumia da tela.
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'UNPAIRED' },
          sync: { status: 'ERROR', errorCode: 'DEVICE_REVOKED' },
        })
        return
      }
      callback({ ok: false, error: 'CONNECTOR_NOT_PAIRED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('no longer connected')
    expect(screen.getByRole('button', { name: 'Reconnect this computer' })).toBeEnabled()
  })

  it('starts a clean run after a durable cursor conflict', async () => {
    const refreshModes: Array<true | undefined> = []
    let restarted = false
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: {
          runId: 'run-conflicted',
          state: 'FAILED',
          safeErrorCode: 'IDEMPOTENCY_CONFLICT',
        },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: restarted
            ? { runId: 'run-clean', status: 'COMPLETED' }
            : { runId: 'run-conflicted', status: 'ERROR', errorCode: 'IDEMPOTENCY_CONFLICT' },
        })
        return
      }
      if (message.type === 'START_NATIONAL_LIFE_SYNC') {
        refreshModes.push(message.forceRefresh)
        restarted = true
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
        latestRun={{ runId: 'run-conflicted', state: 'FAILED' }}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(refreshModes).toEqual([true]))
  })

  it('does not show a stale extension error after the server completed the run', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: { runId: 'run-complete', state: 'COMPLETED', safeErrorCode: null },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: {
            runId: 'run-complete',
            status: 'ERROR',
            errorCode: 'PORTAL_REQUEST_FAILED',
          },
        })
        return
      }
      callback({ ok: false, error: 'PORTAL_REQUEST_FAILED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('connected and ready to sync'))
    expect(status).not.toHaveTextContent('National Life did not respond')
    expect(screen.getByRole('button', { name: 'Sync National Life' })).toBeEnabled()
  })

  it('does not show stale login wait after the server timed out the run', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: {
          runId: 'run-auth-timeout',
          state: 'FAILED',
          safeErrorCode: 'LOCAL_CONNECTOR_TIMEOUT',
        },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { runId: 'run-auth-timeout', status: 'AUTH_REQUIRED', stageIndex: 9 },
        })
        return
      }
      callback({ ok: false, error: 'AUTH_REQUIRED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
        latestRun={{ runId: 'run-auth-timeout', state: 'FAILED' }}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('National Life did not respond'))
    expect(status).not.toHaveTextContent('sign in')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('offers a retry when the protected login episode expired', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: {
            runId: 'run-auth-expired',
            status: 'AUTH_REQUIRED',
            stageIndex: 9,
            errorCode: 'CREDENTIAL_AUTH_STATE_EXPIRED',
          },
        })
        return
      }
      callback({ ok: false, error: 'CREDENTIAL_AUTH_STATE_EXPIRED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('sync stopped before it finished'))
    expect(status).not.toHaveTextContent('same task resumes automatically')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('uses the auth timestamp when the expired worker has no error code', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: {
            runId: 'run-auth-expired-without-code',
            status: 'AUTH_REQUIRED',
            stageIndex: 9,
            authRequiredAt: new Date(Date.now() - 6 * 60_000).toISOString(),
          },
        })
        return
      }
      callback({ ok: false, error: 'AUTH_REQUIRED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('sync stopped before it finished'))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('keeps a server-confirmed partial sync recoverable when the extension retains an error', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: {
            runId: 'run-partial',
            status: 'ERROR',
            errorCode: 'PORTAL_REQUEST_FAILED',
          },
        })
        return
      }
      callback({ ok: false, error: 'PORTAL_REQUEST_FAILED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
        latestRun={{ runId: 'run-partial', state: 'PARTIAL' }}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('saved every available area'))
    expect(status).not.toHaveTextContent('National Life did not respond')

    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveAttribute('data-state', 'waiting')
    expect(presence).toHaveTextContent('I saved the available areas')
  })

  it('tells an out-of-date extension to update instead of to retry', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'ERROR', errorCode: 'UNKNOWN_CAPABILITY' },
        })
        return
      }
      callback({ ok: false, error: 'UNKNOWN_CAPABILITY' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Update the extension'))
    expect(screen.getByRole('link', { name: /update it/i })).toHaveAttribute('href', storeUrl)
  })

  it('distinguishes a portal hiccup from a device that has to be reconnected', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'ERROR', errorCode: 'PORTAL_REQUEST_FAILED' },
        })
        return
      }
      callback({ ok: false, error: 'PORTAL_REQUEST_FAILED' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('National Life did not respond'))
    expect(status).not.toHaveTextContent('no longer connected')
  })

  it('never prints an internal code on screen', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'ERROR', errorCode: 'SOME_INTERNAL_CODE' },
        })
        return
      }
      callback({ ok: false, error: 'SOME_INTERNAL_CODE' })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )

    // A asserção negativa sozinha passa num DOM vazio. Primeiro provamos que a
    // mensagem de falha realmente apareceu; só então "o código não aparece" diz
    // alguma coisa.
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Your sync stopped'))
    expect(document.body.textContent).not.toContain('SOME_INTERNAL_CODE')
  })

  it('keeps saying it is working while a single large stage uploads batch after batch', async () => {
    // Um upload longo deixa status e stageIndex parados. Antes, ~180 rodadas
    // depois o cartão declarava falha num sync que estava indo bem.
    vi.useFakeTimers()
    let uploads = 0
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        uploads += 1
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'UPLOADING', stageIndex: 0, uploads },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await vi.advanceTimersByTimeAsync(0)
    screen.getByRole('button', { name: /National Life/ }).click()

    // Muito além do antigo limite fixo de 180 leituras.
    await vi.advanceTimersByTimeAsync(400_000)

    expect(screen.getByRole('status')).toHaveTextContent('Reading National Life')
    expect(screen.getByRole('status')).toHaveTextContent('batches saved so far')
    vi.useRealTimers()
  })

  it('softens the wording when nothing moves, and never claims a failure', async () => {
    // O sync fica parado de verdade. O watchdog não tem como saber se quebrou,
    // então ele não afirma que quebrou — e continua olhando, mais devagar, para
    // que um run que termine com o agente longe ainda seja visto.
    vi.useFakeTimers()
    let polls = 0
    let completed = false
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        polls += 1
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: {
            status: completed ? 'COMPLETED' : 'UPLOADING',
            stageIndex: 0,
            uploads: 1,
          },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await vi.advanceTimersByTimeAsync(0)
    screen.getByRole('button', { name: /National Life/ }).click()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the portal response')
    expect(screen.getByRole('status')).not.toHaveTextContent('stopped')

    // Continua consultando: o run que termina depois ainda vira sucesso.
    // Continua consultando em vez de sair do laço: um run que termina com o
    // agente longe da tela ainda precisa ser visto. (A virada para sucesso em si
    // já é coberta pelo teste de conclusão.)
    const before = polls
    completed = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(polls).toBeGreaterThan(before)
    expect(screen.getByRole('status')).toHaveTextContent('up to date')
    vi.useRealTimers()
  })

  it('does not freeze the card when the recheck itself fails', async () => {
    // 'syncing' nao e um estado recuperavel: uma rejeicao nao tratada no
    // recheck desabilitaria o botao principal e esconderia o de desconectar,
    // deixando o agente sem saida nenhuma.
    vi.useFakeTimers()
    let broken = false
    installChromeMock((message, callback) => {
      if (broken) {
        callback()
        return
      }
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'UPLOADING', stageIndex: 0, uploads: 1 },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await vi.advanceTimersByTimeAsync(0)
    screen.getByRole('button', { name: 'Sync National Life' }).click()
    await vi.advanceTimersByTimeAsync(60_000)

    const recheck = screen.getByRole('button', { name: 'Check again' })
    expect(recheck).toBeEnabled()
    broken = true
    recheck.click()
    await vi.advanceTimersByTimeAsync(10_000)

    // Sobrou saida: o botao principal continua clicavel.
    expect(screen.getAllByRole('button')[0]).toBeEnabled()
    expect(screen.getByRole('status')).not.toHaveTextContent('Syncing your National Life data')
    vi.useRealTimers()
  })

  it('does not tell a computer that never connected that it was disconnected', async () => {
    // O pareamento é que falhou. "Reconnect" repetiria o mesmo passo com o mesmo
    // texto e o mesmo botao — o laco de novo, uma classe adiante.
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({ ok: true, device: { status: 'ERROR' }, sync: { status: 'IDLE' } })
        return
      }
      if (message.type === 'PAIR_CONNECTOR') {
        callback({ ok: false, error: 'PAIRING_REJECTED' })
        return
      }
      callback({ ok: false, error: 'CONNECTOR_NOT_PAIRED' })
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ code: 'pairing-code-123456' }) })),
    )

    render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('could not finish connecting'))
    expect(status).not.toHaveTextContent('no longer connected')
    expect(screen.getByRole('button', { name: 'Start over' })).toBeEnabled()
  })

  it('stops watching when the agent navigates away from the page', async () => {
    // O laco nao termina sozinho: passado o limite ele so fica mais lento. Sem
    // invalidar o token na desmontagem, sair da pagina deixaria uma consulta a
    // cada 2s para sempre, chamando setState num componente ja morto.
    vi.useFakeTimers()
    let polls = 0
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        polls += 1
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'UPLOADING', stageIndex: 0, uploads: 1 },
        })
        return
      }
      callback({ ok: true })
    })

    const view = render(
      <NationalLifeLocalConnectorCard
        extensionId={extensionId}
        storeUrl={storeUrl}
        installMode="store"
        baseUrl={baseUrl}
      />,
    )
    await vi.advanceTimersByTimeAsync(0)
    screen.getByRole('button', { name: 'Sync National Life' }).click()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(polls).toBeGreaterThan(1)

    view.unmount()
    const afterUnmount = polls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(polls).toBe(afterUnmount)
    vi.useRealTimers()
  })
})
