// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import { NATIONAL_LIFE_SYNC_STARTED_EVENT } from './NationalLifeSyncProgress'
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
    expect(screen.getByRole('status')).toHaveTextContent('Opening the secure install page')
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
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        run: { runId: 'run-partial', state: 'PARTIAL', safeErrorCode: 'SOURCE_PARTIAL_FAILURE' },
      }), { status: 200 }),
    )
    installChromeMock((message, callback) => {
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
      expect(screen.getByRole('status')).toHaveTextContent('available areas were saved')
    })
    expect(screen.getByRole('button', { name: 'Retry remaining areas' })).toBeEnabled()
    expect(screen.getByRole('status')).not.toHaveTextContent('stopped')
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

  it('surfaces AUTH_REQUIRED while the agent logs into National Life', async () => {
    let syncStatus = 'NAVIGATING'
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: syncStatus },
        })
        return
      }
      syncStatus = 'AUTH_REQUIRED'
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
      () => expect(screen.getByRole('status')).toHaveTextContent('Sign in to the National Life portal'),
      { timeout: 3_000 },
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
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
    screen.getByRole('button', { name: 'Connect National Life' }).click()
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
    screen.getByRole('button', { name: 'Connect National Life' }).click()
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
