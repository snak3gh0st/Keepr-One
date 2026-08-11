import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/signed-client', () => ({
  SignedRequestError: class extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  },
  signedJsonRequest: vi.fn(),
}))
vi.mock('../lib/key-store', () => ({
  clearDeviceKeys: vi.fn(),
  getOrCreateDeviceKey: vi.fn(),
}))

import { signedJsonRequest } from '../lib/signed-client'

const NLG = 'https://www.nationallife.com'
const NLG_AUTH0 = 'https://nlg-prod.auth0.com'
const NEW_BUSINESS_PATH = '/agent/book-of-business/new-business/all-new-business-cases'
const INFORCE_PATH = '/agent/book-of-business/inforce-book/all-clients'
const COMMISSIONS_PATH = '/agent/compensation/commissions/paid-commissions'

const TWO_STAGE_PLAN = [
  { capability: 'READ_GRID', params: { gridKey: 'NEW_BUSINESS', navigatePath: NEW_BUSINESS_PATH } },
  { capability: 'READ_GRID', params: { gridKey: 'INFORCE_CLIENTS', navigatePath: INFORCE_PATH } },
]

type Listener = (...args: unknown[]) => unknown

const storage: Record<string, unknown> = {}
const listeners: Record<string, Listener[]> = {}

function register(name: string) {
  return {
    addListener: (fn: Listener) => {
      ;(listeners[name] ??= []).push(fn)
    },
  }
}

const tabs = {
  query: vi.fn(async () => [] as unknown[]),
  update: vi.fn(async () => undefined),
  create: vi.fn(async () => ({ id: 4, active: false, url: undefined })),
  // Tipado com os dois argumentos reais para que um teste possa afirmar sobre a
  // mensagem enviada, e não só sobre ter havido envio.
  sendMessage: vi.fn(async (tabId: number, message: unknown) => {
    void tabId
    const value = message as {
      type?: string
      gridKey?: string
      token?: string
      correlationId?: string
    }
    if (value.type === 'BEGIN_GRID' || value.type === 'ABORT_GRID') {
      return {
        ok: true,
        type: value.type === 'BEGIN_GRID' ? 'BEGIN_GRID_ACK' : 'ABORT_GRID_ACK',
        gridKey: value.gridKey,
        token: value.token,
        correlationId: value.correlationId,
      }
    }
    return { ok: true }
  }),
  onUpdated: register('tabs.onUpdated'),
  onRemoved: register('tabs.onRemoved'),
}

const chromeStub = {
  storage: {
    local: {
      get: async (key: string) => (key in storage ? { [key]: storage[key] } : {}),
      set: async (value: Record<string, unknown>) => {
        Object.assign(storage, value)
      },
      remove: async (key: string) => {
        delete storage[key]
      },
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.1.0' }),
    requestUpdateCheck: vi.fn(async () => ({ status: 'no_update' })),
    reload: vi.fn(),
    onInstalled: register('runtime.onInstalled'),
    onMessage: register('runtime.onMessage'),
    onMessageExternal: register('runtime.onMessageExternal'),
  },
  tabs,
}

/// Boots the background entrypoint the way the browser does: fresh module state (a
/// service worker that was evicted keeps nothing but chrome.storage), listeners
/// registered, `resumePending` already fired.
async function bootBackground() {
  vi.resetModules()
  for (const key of Object.keys(listeners)) delete listeners[key]
  const entry = await import('../entrypoints/background')
  await (entry.default as unknown as () => unknown)()
  // Let resumePending's promise chain settle before the test inspects anything.
  await flush()
}

async function flush() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve()
}

function emit(name: string, ...args: unknown[]) {
  for (const listener of listeners[name] ?? []) listener(...args)
}

function readSync() {
  return storage.sync as Record<string, unknown>
}

const EXTERNAL_SENDER = {
  origin: 'http://localhost:3000',
  url: 'http://localhost:3000/agent/integrations/national-life',
}

function beginGridMessage() {
  const call = tabs.sendMessage.mock.calls.at(-1) as unknown as [number, Record<string, unknown>]
  return call?.[1]
}

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key]
  vi.clearAllMocks()
  vi.mocked(signedJsonRequest).mockResolvedValue({})
  tabs.query.mockResolvedValue([])
  storage.device = { deviceId: 'device-1', baseUrl: 'http://localhost:3000', status: 'READY' }
  vi.stubGlobal('chrome', chromeStub)
  vi.stubGlobal('defineBackground', (main: unknown) => main)
  // The extension's own vitest config substitutes this at build time; the repo-root
  // config does not, and without it every allowed-origin check fails.
  vi.stubGlobal('__KEEPR_ORIGIN__', 'http://localhost:3000')
})

describe('empurrão de atualização no caminho real', () => {
  it('empurra quando o servidor diz que esta versão está abaixo do piso', async () => {
    // O caso que quase escapou: `failSync` roda **dentro** de `withSyncLock`, então
    // um `isBusy` que consultasse o lock devolveria BUSY sempre e o empurrão nunca
    // aconteceria — exatamente no gatilho para o qual ele foi construído.
    vi.mocked(signedJsonRequest).mockRejectedValue(
      Object.assign(new Error('CLIENT_TOO_OLD'), { code: 'CLIENT_TOO_OLD' }),
    )
    await bootBackground()

    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CLIENT_TOO_OLD' })
    expect(chromeStub.runtime.requestUpdateCheck).toHaveBeenCalled()
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    // E a trava ficou gravada antes do reload, não depois.
    expect(storage.updateNudge).toMatchObject({ version: '0.1.0', reloadCount: 1 })
  })

  it('a trava persistida sobrevive à morte do worker e barra o segundo reload', async () => {
    // Esta é a asserção que um `chrome.runtime.reload()` solto no lugar do
    // empurrão **não** satisfaz: ele recarregaria de novo. Reiniciar o worker é o
    // caso real — reload() mata o worker, então a segunda decisão sempre acontece
    // num módulo recém-carregado, com os globais zerados.
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))
    await bootBackground()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)

    // Worker morre e volta. Só o chrome.storage.local sobrevive.
    await bootBackground()
    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    expect(storage.updateNudge).toMatchObject({ reloadCount: 1 })
  })

  it('empurra quando o 426 chega no PUT de um lote, não no início do run', async () => {
    // O caminho dominante de verdade: subir o piso contra runs já em voo é o que
    // "subir o piso" significa operacionalmente, e aí a recusa chega no upload de
    // um lote. `processBridgeMessage` chama `failSync` com a própria entrada dele
    // ainda pendente na fila da aba — contar essa entrada devolvia BUSY sempre,
    // que é o mesmo erro do `syncStartLock`, um braço adiante.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CLIENT_TOO_OLD' })
    expect(chromeStub.runtime.reload).toHaveBeenCalledTimes(1)
    expect(storage.updateNudge).toMatchObject({ version: '0.1.0', reloadCount: 1 })
  })

  it('manda o extrator parar quando o servidor recusa o lote por pausa', async () => {
    // Recusar o upload já impedia o dado de entrar. O que não parava era a
    // extração: o laço na página fala com o portal, não com o Keepr One, e
    // seguia paginando a National Life até o estágio acabar sozinho.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CONNECTOR_PAUSED'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'CONNECTOR_PAUSED' })
    // A ordem tem de falar da extração que está rodando: com token de outra, a
    // página a ignoraria e continuaria dirigindo o portal.
    expect(tabs.sendMessage).toHaveBeenLastCalledWith(7, {
      type: 'ABORT_GRID',
      gridKey: 'NEW_BUSINESS',
      token: begin.token,
      correlationId: begin.correlationId,
    })
  })

  it('manda parar antes de recarregar a extensão no 426', async () => {
    // Ordem, não coincidência: `failSync` num CLIENT_TOO_OLD pode chamar
    // `chrome.runtime.reload()`, que mata este worker. Uma ordem de parar
    // emitida depois disso nunca sairia, e o portal seguiria sendo dirigido
    // exatamente no caso em que a extensão inteira está sendo trocada.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    const begin = beginGridMessage()

    const order: string[] = []
    tabs.sendMessage.mockImplementation(async (_tabId: number, message: unknown) => {
      order.push((message as { type: string }).type)
      return { ok: true }
    })
    chromeStub.runtime.reload.mockImplementation(() => {
      order.push('reload')
    })
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('CLIENT_TOO_OLD'))

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(order).toEqual(['ABORT_GRID', 'reload'])
  })

  it('não empurra numa falha que atualizar não resolve', async () => {
    vi.mocked(signedJsonRequest).mockRejectedValue(new Error('PORTAL_REQUEST_FAILED'))
    await bootBackground()

    emit('runtime.onMessageExternal', { type: 'START_NATIONAL_LIFE_SYNC' }, EXTERNAL_SENDER, vi.fn())
    await flush()

    expect(chromeStub.runtime.reload).not.toHaveBeenCalled()
  })
})

describe('background plan executor', () => {
  it('advances to the next stage of the plan when a grid finishes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    const begin = beginGridMessage()
    expect(begin).toMatchObject({ type: 'BEGIN_GRID', gridKey: 'NEW_BUSINESS' })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK', gridKey: 'NEW_BUSINESS', token: begin.token,
        correlationId: begin.correlationId, sequence: 0, recordsTotal: 1,
        truncated: false, records: [{ PolicyNo: 'NB-1' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` }, vi.fn(),
    )

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ runId: 'run-1', stageIndex: 1, status: 'NAVIGATING' })
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${INFORCE_PATH}` })
  })

  it('completes the run when the last stage of the plan finishes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    const begin = beginGridMessage()
    expect(begin).toMatchObject({ gridKey: 'INFORCE_CLIENTS' })

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK', gridKey: 'INFORCE_CLIENTS', token: begin.token,
        correlationId: begin.correlationId, sequence: 0, recordsTotal: 1,
        truncated: false, records: [{ PolicyNumber: 'IF-1' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` }, vi.fn(),
    )

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_DONE',
        gridKey: 'INFORCE_CLIENTS',
        token: begin.token,
        correlationId: begin.correlationId,
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    // A data de conclusão é o que impede a página de dizer "concluído" para
    // sempre: sem ela, um COMPLETED grudento não tem como ser datado.
    expect(readSync()).toMatchObject({ runId: 'run-1', status: 'COMPLETED' })
    expect(typeof readSync().completedAt).toBe('string')
    expect(readSync().plan).toBeUndefined()
  })

  it('drops the pairing only when the server says the device is revoked', async () => {
    // Um 401 genérico não basta: ele cobre relógio fora da janela, que persiste
    // depois de reparear. Só a afirmação explícita solta o pareamento.
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    const { SignedRequestError } = await import('../lib/signed-client')
    vi.mocked(signedJsonRequest).mockRejectedValue(
      new (SignedRequestError as unknown as new (code: string) => Error)('DEVICE_REVOKED'),
    )
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(storage.device).toMatchObject({ status: 'UNPAIRED' })
    expect(storage.device).not.toHaveProperty('deviceId')
    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'DEVICE_REVOKED' })
  })

  it('keeps the pairing on a bare rejection, which may be nothing but clock skew', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    const { SignedRequestError } = await import('../lib/signed-client')
    vi.mocked(signedJsonRequest).mockRejectedValue(
      new (SignedRequestError as unknown as new (code: string) => Error)(
        'DEVICE_REQUEST_REJECTED',
      ),
    )
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'NEW_BUSINESS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ a: 'b' }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    expect(storage.device).toMatchObject({ status: 'READY', deviceId: 'device-1' })
    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'DEVICE_REQUEST_REJECTED' })
  })

  it('counts uploaded batches so a long single stage still proves it is alive', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue(undefined as never)
    await bootBackground()
    const begin = beginGridMessage()

    for (const sequence of [0, 1]) {
      emit(
        'runtime.onMessage',
        {
          type: 'GRID_CHUNK',
          gridKey: 'NEW_BUSINESS',
          token: begin.token,
          correlationId: begin.correlationId,
          sequence,
          recordsTotal: 2,
          truncated: sequence === 0,
          records: [{ a: 'b' }],
        },
        { tab: { id: 7 }, url: `${NLG}/agent/anything` },
        vi.fn(),
      )
      await flush()
    }

    expect(readSync()).toMatchObject({ status: 'UPLOADING', stageIndex: 0, uploads: 2 })
  })

  it('resumes mid-plan after the service worker is evicted', async () => {
    // Nothing survives eviction except chrome.storage: the plan and the index in it are
    // the whole of what the next boot knows about the run.
    storage.sync = { runId: 'run-1', carrierTabId: 9, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'EXTRACTING' }
    tabs.query.mockResolvedValue([{ id: 9, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'INFORCE_CLIENTS' }),
    )
    expect(readSync()).toMatchObject({ stageIndex: 1, status: 'EXTRACTING' })
  })

  it('returns to the current stage when a stale carrier page is open', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    emit(
      'tabs.onUpdated',
      7,
      { status: 'complete' },
      { url: `${NLG}${INFORCE_PATH}` },
    )
    await flush()

    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(tabs.update).toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ stageIndex: 0, status: 'NAVIGATING' })
  })

  it('retries a temporarily locked Chrome tab instead of abandoning the sync', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${INFORCE_PATH}` }])
    tabs.update
      .mockRejectedValueOnce(new Error('Tabs cannot be edited right now (user may be dragging a tab).'))
      .mockResolvedValue(undefined)

    await bootBackground()
    await new Promise((resolve) => setTimeout(resolve, 75))

    expect(tabs.update).toHaveBeenCalledTimes(2)
    expect(tabs.update).toHaveBeenLastCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
    expect(readSync()).toMatchObject({ status: 'NAVIGATING', stageIndex: 0 })
  })

  it('opens a background carrier tab when the visible carrier tab is on another page', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    await bootBackground()

    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(tabs.update).not.toHaveBeenCalledWith(7, { url: `${NLG}${NEW_BUSINESS_PATH}` })
  })

  it('starts extraction when Check again finds the current grid already open', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-1',
      schemaVersion: 2,
      stages: TWO_STAGE_PLAN,
      duplicate: true,
    } as never)
    await bootBackground()
    tabs.sendMessage.mockClear()
    storage.sync = { ...readSync(), status: 'NAVIGATING' }

    emit('runtime.onMessage', { type: 'RETRY_SYNC' }, {}, vi.fn())
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'NEW_BUSINESS' }),
    )
    expect(readSync()).toMatchObject({ status: 'EXTRACTING', stageIndex: 0 })
  })

  it('goes to AUTH_REQUIRED instead of extracting on an auth interstitial', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}/agent/auth/login` }])
    await bootBackground()

    emit('tabs.onUpdated', 7, { status: 'complete' }, { url: `${NLG}/agent/auth/login` })
    await flush()

    expect(tabs.sendMessage).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED' })
  })

  it('resumes the pending grid when login returns to the authenticated agent shell', async () => {
    storage.sync = { runId: 'run-1', plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'AUTH_REQUIRED' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}/agent/` }])
    await bootBackground()

    expect(tabs.create).toHaveBeenCalledWith({
      active: true,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(readSync()).toMatchObject({ status: 'NAVIGATING', stageIndex: 0 })
  })

  it('recreates a closed carrier tab without stealing focus', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'EXTRACTING' }
    tabs.query.mockResolvedValueOnce([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()

    emit('tabs.onRemoved', 7)
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({
      active: false,
      url: `${NLG}${NEW_BUSINESS_PATH}`,
    })
    expect(readSync()).toMatchObject({ runId: 'run-1', stageIndex: 0, status: 'NAVIGATING' })
  })

  it('does not re-navigate the connector when an unrelated tab closes', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'EXTRACTING' }
    tabs.query.mockResolvedValue([{ id: 7, active: false, url: `${NLG}${NEW_BUSINESS_PATH}` }])
    await bootBackground()
    tabs.create.mockClear()
    tabs.update.mockClear()

    emit('tabs.onRemoved', 99)
    await flush()

    expect(tabs.create).not.toHaveBeenCalled()
    expect(tabs.update).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ carrierTabId: 7, status: 'EXTRACTING' })
  })

  it('keeps the Auth0 login tab instead of opening another login', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 12, plan: TWO_STAGE_PLAN, stageIndex: 0, status: 'AUTH_REQUIRED' }
    tabs.query.mockResolvedValue([{ id: 12, active: true, url: `${NLG_AUTH0}/login?state=pending` }])
    await bootBackground()

    expect(tabs.update).toHaveBeenCalledWith(12, { active: true })
    expect(tabs.create).not.toHaveBeenCalled()
    expect(readSync()).toMatchObject({ status: 'AUTH_REQUIRED', stageIndex: 0 })
  })

  it('starts a fresh run when the stored state predates the plan shape', async () => {
    // This is the whole storage migration: an installed extension holds `nextGrid`, not
    // a plan. Every guard reads currentStage(), so the old shape is simply "no run in
    // progress" and the server hands back the plan for the run it already has open.
    storage.sync = { runId: 'run-old', nextGrid: 'NEW_BUSINESS', status: 'NAVIGATING' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-old',
      schemaVersion: 2,
      stages: TWO_STAGE_PLAN,
      duplicate: true,
    } as never)
    await bootBackground()

    const sendResponse = vi.fn()
    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      sendResponse,
    )
    await flush()

    expect(vi.mocked(signedJsonRequest).mock.calls[0]![0]).toMatchObject({
      method: 'POST',
      pathname: '/api/agent/integrations/national-life/local-connector/runs',
    })
    expect(readSync()).toMatchObject({
      runId: 'run-old',
      stageIndex: 0,
      status: 'NAVIGATING',
      plan: TWO_STAGE_PLAN,
    })
  })

  it('refuses to navigate on a stored plan that no longer validates', async () => {
    // Storage survives extension updates, so a plan is revalidated on every read. A
    // path outside the agent tree degrades to "no plan" instead of steering a tab.
    storage.sync = {
      runId: 'run-1',
      plan: [{ capability: 'READ_GRID', params: { gridKey: 'X', navigatePath: '/NWI/admin' } }],
      stageIndex: 0,
      status: 'NAVIGATING',
    }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-2',
      schemaVersion: 2,
      stages: TWO_STAGE_PLAN,
      duplicate: false,
    } as never)
    await bootBackground()

    // resumePending saw no usable stage, so nothing was navigated.
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.create).not.toHaveBeenCalled()

    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      vi.fn(),
    )
    await flush()

    expect(readSync()).toMatchObject({ runId: 'run-2', stageIndex: 0, status: 'NAVIGATING' })
  })

  it('rejects a run response whose stage plan is not safe', async () => {
    storage.sync = { status: 'IDLE' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-3',
      schemaVersion: 2,
      stages: [
        { capability: 'READ_GRID', params: { gridKey: 'X', navigatePath: 'https://evil.example/agent/x' } },
      ],
      duplicate: false,
    } as never)
    await bootBackground()

    const sendResponse = vi.fn()
    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      sendResponse,
    )
    await flush()

    expect(readSync()).toMatchObject({ status: 'ERROR', errorCode: 'UNSAFE_NAVIGATE_PATH' })
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.create).not.toHaveBeenCalled()
  })

  it('drives a plan carrying a grid the extension has no knowledge of', async () => {
    // The payoff: a grid that never appeared in any extension release is navigated and
    // extracted purely from the plan.
    storage.sync = { status: 'IDLE' }
    vi.mocked(signedJsonRequest).mockResolvedValue({
      runId: 'run-4',
      schemaVersion: 2,
      stages: [
        {
          capability: 'READ_GRID',
          params: { gridKey: 'PAID_COMMISSIONS', navigatePath: COMMISSIONS_PATH },
        },
      ],
      duplicate: false,
    } as never)
    await bootBackground()

    emit(
      'runtime.onMessageExternal',
      { type: 'START_NATIONAL_LIFE_SYNC' },
      { origin: 'http://localhost:3000', url: 'http://localhost:3000/agent/integrations' },
      vi.fn(),
    )
    await flush()

    expect(tabs.create).toHaveBeenCalledWith({ active: false, url: `${NLG}${COMMISSIONS_PATH}` })

    emit('tabs.onUpdated', 4, { status: 'complete' }, { url: `${NLG}${COMMISSIONS_PATH}` })
    await flush()

    expect(tabs.sendMessage).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ type: 'BEGIN_GRID', gridKey: 'PAID_COMMISSIONS' }),
    )
  })

  it('uploads raw rows under schemaVersion 2 with a stage-scoped idempotency key', async () => {
    storage.sync = { runId: 'run-1', carrierTabId: 7, plan: TWO_STAGE_PLAN, stageIndex: 1, status: 'NAVIGATING' }
    tabs.query.mockResolvedValue([{ id: 7, active: true, url: `${NLG}${INFORCE_PATH}` }])
    vi.mocked(signedJsonRequest).mockResolvedValue({} as never)
    await bootBackground()
    const begin = beginGridMessage()

    emit(
      'runtime.onMessage',
      {
        type: 'GRID_CHUNK',
        gridKey: 'INFORCE_CLIENTS',
        token: begin.token,
        correlationId: begin.correlationId,
        sequence: 0,
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNumber: 'NL-1', Anything: { nested: true } }],
      },
      { tab: { id: 7 }, url: `${NLG}/agent/anything` },
      vi.fn(),
    )
    await flush()

    const request = vi.mocked(signedJsonRequest).mock.calls[0]![0]
    expect(request).toMatchObject({
      method: 'PUT',
      pathname:
        '/api/agent/integrations/national-life/local-connector/runs/run-1/stages/INFORCE_CLIENTS',
      idempotencyKey: 'nlc:run-1:1:INFORCE_CLIENTS:0',
    })
    expect(request.body).toMatchObject({
      schemaVersion: 2,
      gridKey: 'INFORCE_CLIENTS',
      records: [{ PolicyNumber: 'NL-1', Anything: { nested: true } }],
    })
  })
})
