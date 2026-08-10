import { parseStagePlan } from '../lib/capabilities'
import {
  CONNECTOR_SCHEMA_VERSION,
  CONNECTOR_VERSION_HEADER,
  readExtensionVersion,
} from '../lib/contract'
import {
  NLG_AUTH0_ORIGIN,
  NLG_ORIGIN,
  allowedKeeprOrigins,
  isAuthPath,
  requireAllowedBaseUrl,
} from '../lib/constants'
import { clearDeviceKeys, getOrCreateDeviceKey } from '../lib/key-store'
import {
  parseBridgeMessage,
  parseExternalMessage,
  type AbortGridMessage,
  type BeginGridMessage,
  type BridgeMessage,
} from '../lib/messages'
import { OUTDATED_CODES, revokesDevice } from '../lib/failure'
import {
  PERMISSIVE_REMOTE_CONFIG,
  ensureFreshRemoteConfig,
  readCachedRemoteConfig,
} from '../lib/remote-config'
import {
  UPDATE_NUDGE_KEY,
  isBusySyncStatus,
  nudgeExtensionUpdate,
  type UpdateNudgeRecord,
} from '../lib/update-nudge'
import { SignedRequestError, signedJsonRequest } from '../lib/signed-client'
import {
  currentStage,
  readDeviceState,
  readSyncState,
  writeDeviceState,
  writeSyncState,
} from '../lib/state'

type ActiveNavigation = BeginGridMessage & { tabId: number }

const activeNavigations = new Map<number, ActiveNavigation>()
const tabQueues = new Map<number, Promise<void>>()
/// Quantas mensagens da ponte estão pendentes por aba, incluindo a que está sendo
/// processada agora. `tabQueues` sozinho não distingue "uma mensagem, que sou eu"
/// de "uma mensagem minha e outras esperando".
const pendingBridgeMessages = new Map<number, number>()
let syncStartLock: Promise<unknown> | null = null

function versionedHeaders(base: Record<string, string>): Record<string, string> {
  const version = readExtensionVersion()
  return version ? { ...base, [CONNECTOR_VERSION_HEADER]: version } : base
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function senderAllowed(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.origin || !sender.url) return false
  try {
    const urlOrigin = new URL(sender.url).origin
    return sender.origin === urlOrigin && allowedKeeprOrigins().includes(urlOrigin)
  } catch {
    return false
  }
}

async function withSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  while (syncStartLock) {
    try {
      await syncStartLock
    } catch {
      // Previous start failed; allow the next caller to proceed.
    }
  }
  const run = operation()
  syncStartLock = run.finally(() => {
    if (syncStartLock === run) syncStartLock = null
  })
  return run
}

async function pairConnector(
  message: Extract<ReturnType<typeof parseExternalMessage>, { type: 'PAIR_CONNECTOR' }>,
) {
  const baseUrl = requireAllowedBaseUrl(message.baseUrl)
  await writeDeviceState({ baseUrl, status: 'PAIRING' })
  try {
    const publicKeyJwk = await getOrCreateDeviceKey()
    const response = await fetch(
      `${baseUrl}/api/agent/integrations/national-life/local-connector/pairings/exchange`,
      {
        method: 'POST',
        // O pareamento é a única requisição que não passa por `signedJsonRequest`
        // (ainda não há chave para assinar). Carimbar a versão aqui também é o que
        // faz "toda requisição carrega a versão" ser verdade e não quase-verdade.
        headers: versionedHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          code: message.code,
          label: message.label,
          publicKeyJwk,
        }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      },
    )
    if (!response.ok) throw new Error('PAIRING_REJECTED')
    const result = (await response.json()) as { deviceId?: unknown }
    if (
      typeof result.deviceId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(result.deviceId)
    ) {
      throw new Error('PAIRING_REJECTED')
    }
    await writeDeviceState({ deviceId: result.deviceId, baseUrl, status: 'READY' })
    return { ok: true as const, deviceId: result.deviceId }
  } catch {
    await writeDeviceState({ baseUrl, status: 'ERROR' })
    return { ok: false as const, error: 'PAIRING_REJECTED' }
  }
}

async function unpairConnector() {
  const device = await readDeviceState()
  await clearDeviceKeys()
  await writeDeviceState({ status: 'UNPAIRED' })
  await writeSyncState({ status: 'IDLE' })
  activeNavigations.clear()
  tabQueues.clear()
  return { ok: true as const, deviceId: device.deviceId }
}

async function reportRunFailure(code: string) {
  const device = await readDeviceState()
  const state = await readSyncState()
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !state.runId ||
    state.runId.length > 128
  ) {
    return
  }
  try {
    await signedJsonRequest({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'POST',
      pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/fail`,
      body: { code: code.replace(/[^A-Z0-9_]/g, '_').slice(0, 80) || 'SYNC_FAILED' },
    })
  } catch {
    // Local ERROR state remains the source of truth if the fail call cannot land.
  }
}

/// Esquece o pareamento sem tocar no estado do sync. `unpairConnector` zera o
/// sync para IDLE — correto quando o agente desconecta de propósito, errado aqui:
/// o motivo da falha precisa sobreviver para a página poder explicá-lo.
async function forgetRevokedDevice() {
  const device = await readDeviceState()
  await clearDeviceKeys()
  await writeDeviceState({ baseUrl: device.baseUrl, status: 'UNPAIRED' })
  activeNavigations.clear()
  tabQueues.clear()
}

/// Único caminho de falha do sync. Grava o motivo, tenta avisar o servidor e só
/// então derruba um pareamento que o servidor declarou morto — é o que troca
/// "tentar de novo para sempre" por "reconectar".
///
/// Na revogação, o aviso ao servidor é uma requisição assinada pela mesma chave
/// que acabou de ser recusada: ele não chega, e não há como fazer chegar daqui.
/// Quem encerra o run naquele caso é o próprio servidor, em
/// `revokeLocalConnectorDevice`, que já derruba os runs abertos do dispositivo.
/// O auto-conserto, e a única coisa no arquivo que pode desabilitar a extensão se
/// for feita errado. Toda a trava mora em `nudgeExtensionUpdate`; aqui só ficam as
/// dependências, e duas delas são o ponto:
///
/// - `isBusy` olha o estado **persistido** além dos mapas em memória. Num worker
///   recém-iniciado os mapas estão vazios embora um run esteja genuinamente no
///   meio segundo o storage — confiar só neles chamaria "ponto seguro" exatamente
///   o momento mais perigoso.
/// - `writeRecord` grava no `chrome.storage.local`, que sobrevive ao worker. Um
///   global de módulo morreria junto com o reload que ele deveria estar contando.
async function nudgeUpdateIfSafe(selfTabId?: number): Promise<void> {
  await nudgeExtensionUpdate({
    now: () => Date.now(),
    version: () => readExtensionVersion(),
    readRecord: async () => {
      const result = await chrome.storage.local.get(UPDATE_NUDGE_KEY)
      return result[UPDATE_NUDGE_KEY] as UpdateNudgeRecord | undefined
    },
    writeRecord: async (record) => {
      await chrome.storage.local.set({ [UPDATE_NUDGE_KEY]: record })
    },
    requestUpdateCheck: async () => {
      await chrome.runtime.requestUpdateCheck()
    },
    reload: () => chrome.runtime.reload(),
    /// A regra, e ela tem exatamente uma forma: **nada que conte a própria
    /// operação que está falhando**. Esse erro já foi cometido duas vezes aqui, em
    /// dois braços diferentes, e as duas vezes o efeito foi o mesmo — o empurrão
    /// devolvia BUSY para sempre e o recurso morria no gatilho mais importante.
    ///
    /// - `syncStartLock` fica de fora: um 426 vindo de `startNewSync` roda dentro
    ///   de `withSyncLock`, então o lock é a promessa da própria operação falhando.
    /// - a fila da aba é **descontada de uma unidade** quando a falha vem da ponte:
    ///   `processBridgeMessage` chama `failSync` com a sua própria entrada ainda
    ///   pendente em `tabQueues`. Esse é o caminho dominante de um 426, porque um
    ///   piso subido contra runs em voo é exatamente o que "subir o piso"
    ///   significa: a recusa chega no PUT de um lote, não no início do run.
    ///
    /// O que sobra é trabalho de verdade: outras abas, outras mensagens na mesma
    /// aba, e o estado persistido — que `failSync` acabou de mover para ERROR, de
    /// modo que só um sync *concorrente* o deixa ocupado.
    isBusy: async () => {
      if (activeNavigations.size > 0) return true
      let pending = 0
      for (const count of pendingBridgeMessages.values()) pending += count
      if (selfTabId !== undefined) pending -= 1
      if (pending > 0) return true
      const state = await readSyncState()
      return isBusySyncStatus(state.status)
    },
  })
}

async function failSync(code: string, selfTabId?: number) {
  await writeSyncState({ ...(await readSyncState()), status: 'ERROR', errorCode: code })
  await reportRunFailure(code)
  if (revokesDevice(code)) await forgetRevokedDevice()
  // O servidor afirmou que esta versão não serve mais. É o único gatilho: um
  // empurrão a cada falha genérica gastaria as tentativas contra problemas que
  // atualizar não resolve. `failSync` já gravou o ERROR, e o estado de sync
  // acabou de sair dos estados ocupados — por isso o empurrão vem depois.
  if (OUTDATED_CODES.includes(code)) await nudgeUpdateIfSafe(selfTabId)
}

async function createRun() {
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    throw new Error('CONNECTOR_NOT_PAIRED')
  }
  // Lê o **cache**, não a rede. Bloquear o começo do sync numa requisição extra
  // trocaria uma alavanca de emergência por latência em todo sync e por mais um
  // ponto de falha no caminho que mais importa. Quem recusa de verdade é o
  // endpoint de run, na mesma viagem que já íamos fazer; isto aqui só evita abrir
  // um run condenado quando já sabemos, e dá ao agente a frase certa.
  const remote = (await readCachedRemoteConfig()) ?? PERMISSIVE_REMOTE_CONFIG
  if (!remote.syncEnabled || remote.disabledCapabilities.includes('READ_GRID')) {
    throw new Error('CONNECTOR_PAUSED')
  }
  await writeSyncState({ status: 'STARTING' })
  const response = await signedJsonRequest<{ runId?: unknown; stages?: unknown }>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: '/api/agent/integrations/national-life/local-connector/runs',
    body: {},
  })
  if (typeof response.runId !== 'string' || response.runId.length === 0) {
    throw new Error('INVALID_RUN_RESPONSE')
  }
  // The server decides which stages this run has and in what order; the extension
  // only checks that every one of them names a capability it implements and a path
  // inside the agent tree. Adding a grid is a server deploy, not a release here.
  const plan = parseStagePlan(response.stages)
  await writeSyncState({ runId: response.runId, plan, stageIndex: 0, status: 'NAVIGATING' })
}

async function findNationalLifeTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({
    url: [`${NLG_ORIGIN}/*`, `${NLG_AUTH0_ORIGIN}/*`],
  })
  const carrierTabs = tabs.filter((tab) => {
    if (typeof tab.url !== 'string') return false
    try {
      return new URL(tab.url).origin === NLG_ORIGIN
    } catch {
      return false
    }
  })
  return carrierTabs.find((tab) => typeof tab.id === 'number' && tab.active) ?? carrierTabs.find((tab) => typeof tab.id === 'number')
}

async function findNationalLifeAuthTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({
    url: [`${NLG_ORIGIN}/*`, `${NLG_AUTH0_ORIGIN}/*`],
  })
  const authTabs = tabs.filter((tab) => {
    if (typeof tab.url !== 'string') return false
    try {
      return new URL(tab.url).origin === NLG_AUTH0_ORIGIN
    } catch {
      return false
    }
  })
  return authTabs.find((tab) => typeof tab.id === 'number' && tab.active) ?? authTabs.find((tab) => typeof tab.id === 'number')
}

async function navigatePendingGrid() {
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !stage) return
  const target = `${NLG_ORIGIN}${stage.params.navigatePath}`
  const existing = await findNationalLifeTab()
  if (existing?.id !== undefined && existing.url) {
    try {
      if (isAuthPath(new URL(existing.url).pathname)) {
        await writeSyncState({ ...state, status: 'AUTH_REQUIRED', errorCode: undefined })
        await chrome.tabs.update(existing.id, { active: true })
        return
      }
    } catch {
      // Fall through to the normal target navigation for an unparseable tab URL.
    }
  }
  if (existing?.id === undefined) {
    const authTab = await findNationalLifeAuthTab()
    if (authTab?.id !== undefined) {
      await writeSyncState({ ...state, status: 'AUTH_REQUIRED', errorCode: undefined })
      await chrome.tabs.update(authTab.id, { active: true })
      return
    }
  }
  await writeSyncState({ ...state, status: 'NAVIGATING', errorCode: undefined })
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true, url: target })
  } else {
    await chrome.tabs.create({ active: true, url: target })
  }
}

async function startNewSync() {
  return withSyncLock(async () => {
    try {
      const current = await readSyncState()
      if (
        current.runId &&
        currentStage(current) &&
        ['NAVIGATING', 'EXTRACTING', 'UPLOADING', 'AUTH_REQUIRED', 'STARTING'].includes(
          current.status,
        )
      ) {
        await navigatePendingGrid()
        const after = await readSyncState()
        if (after.status === 'AUTH_REQUIRED') {
          return { ok: false as const, error: 'AUTH_REQUIRED' }
        }
        return { ok: true as const, status: after.status }
      }
      await createRun()
      await navigatePendingGrid()
      return { ok: true as const, status: 'NAVIGATING' as const }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SYNC_START_FAILED'
      // Não pareado não é falha do sync: é o estado inicial de quem ainda não
      // conectou. Gravá-lo como ERROR faria a página abrir acusando um problema.
      if (code === 'CONNECTOR_NOT_PAIRED') {
        await writeSyncState({ status: 'IDLE' })
        return { ok: false as const, error: code }
      }
      await failSync(code)
      return { ok: false as const, error: code }
    }
  })
}

async function beginExtraction(tabId: number, gridKey: string) {
  if (activeNavigations.get(tabId)?.gridKey === gridKey) return
  const message: BeginGridMessage = {
    type: 'BEGIN_GRID',
    gridKey,
    token: randomToken(),
    correlationId: crypto.randomUUID(),
  }
  activeNavigations.set(tabId, { ...message, tabId })
  await writeSyncState({ ...(await readSyncState()), status: 'EXTRACTING', errorCode: undefined })
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    activeNavigations.delete(tabId)
    await failSync('BRIDGE_UNAVAILABLE')
  }
}

async function handleTabReady(tabId: number, urlValue?: string) {
  if (!urlValue) return
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return
  }
  if (url.origin !== NLG_ORIGIN) return
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !stage || state.status === 'COMPLETED' || state.status === 'ERROR') {
    return
  }
  if (isAuthPath(url.pathname)) {
    await writeSyncState({ ...state, status: 'AUTH_REQUIRED' })
    return
  }
  // The carrier may finish Auth0/MFA by redirecting to the authenticated agent
  // shell instead of returning directly to the grid we were waiting for. That
  // shell is proof that the login completed; resume the pending stage here so the
  // user does not have to click Sync again (and accidentally start another login
  // navigation).
  if (state.status === 'AUTH_REQUIRED' && url.pathname.startsWith('/agent/')) {
    await navigatePendingGrid()
    return
  }
  if (url.pathname !== stage.params.navigatePath) {
    // Do not force-navigate away from MFA/interstitial pages. Only resume
    // extraction when the expected grid is already open.
    if (state.status !== 'AUTH_REQUIRED') {
      await writeSyncState({ ...state, status: 'NAVIGATING' })
    }
    return
  }
  await beginExtraction(tabId, stage.params.gridKey)
}

async function uploadChunk(message: Extract<BridgeMessage, { type: 'GRID_CHUNK' }>) {
  const device = await readDeviceState()
  const state = await readSyncState()
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !state.runId ||
    state.runId.length > 128 ||
    currentStage(state)?.params.gridKey !== message.gridKey
  ) {
    throw new Error('SYNC_STATE_INVALID')
  }
  await writeSyncState({ ...state, status: 'UPLOADING', errorCode: undefined })
  const pathname = `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/stages/${encodeURIComponent(message.gridKey)}`
  try {
    await signedJsonRequest({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'PUT',
      pathname,
      // The stage index is in the key because the plan is server-supplied now: two
      // stages naming the same grid would otherwise share an idempotency key and
      // silently collide. Retries of the same chunk still reuse the same key.
      idempotencyKey: `nlc:${state.runId}:${state.stageIndex ?? 0}:${message.gridKey}:${message.sequence}`,
      body: {
        // Raw carrier rows, exactly as the portal returned them. Field names and
        // meanings are the server's business now.
        schemaVersion: CONNECTOR_SCHEMA_VERSION,
        runId: state.runId,
        gridKey: message.gridKey,
        sequence: message.sequence,
        observedAt: new Date().toISOString(),
        recordsTotal: message.recordsTotal,
        truncated: message.truncated,
        records: message.records,
      },
    })
  } catch (error) {
    if (error instanceof SignedRequestError && error.code === 'IDEMPOTENCY_CONFLICT') {
      throw new Error('IDEMPOTENCY_CONFLICT')
    }
    throw error
  }
  // Prova de vida do run. É o único sinal que se move quando uma única grade
  // grande passa minutos subindo lote a lote.
  const after = await readSyncState()
  await writeSyncState({ ...after, uploads: (after.uploads ?? 0) + 1 })
}

async function finishGrid(tabId: number, gridKey: string) {
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !state.plan || stage?.params.gridKey !== gridKey) {
    throw new Error('SYNC_STATE_INVALID')
  }
  activeNavigations.delete(tabId)
  // currentStage already proved the stored plan parses; re-derive it so navigation
  // reads the validated array rather than the raw storage value.
  const plan = parseStagePlan(state.plan)
  const nextIndex = (state.stageIndex ?? 0) + 1
  const next = plan[nextIndex]
  if (!next) {
    await writeSyncState({
      runId: state.runId,
      status: 'COMPLETED',
      uploads: state.uploads,
      completedAt: new Date().toISOString(),
    })
    return
  }
  await writeSyncState({
    runId: state.runId,
    plan,
    stageIndex: nextIndex,
    status: 'NAVIGATING',
    uploads: state.uploads,
  })
  await chrome.tabs.update(tabId, { url: `${NLG_ORIGIN}${next.params.navigatePath}` })
}

/// Manda o extrator parar onde está.
///
/// É o que faltava para a pausa do servidor alcançar um run em voo. Recusar o
/// upload já impedia o dado de entrar, mas não impedia a extração de continuar:
/// o laço na página fala com o portal, não com o Keepr One, e seguia paginando a
/// National Life até o estágio acabar sozinho. Para uma emergência nossa isso era
/// tolerável; para a seguradora pedindo que a automação pare, não é.
///
/// Silenciosa de propósito quando não há extração ativa ou quando a aba sumiu:
/// as duas coisas são a mesma parada, por outro caminho.
async function abortExtraction(tabId: number) {
  const active = activeNavigations.get(tabId)
  if (!active) return
  const message: AbortGridMessage = {
    type: 'ABORT_GRID',
    gridKey: active.gridKey,
    token: active.token,
    correlationId: active.correlationId,
  }
  try {
    await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // Aba fechada, ponte ausente: não há o que parar.
  }
}

async function processBridgeMessage(tabId: number, message: BridgeMessage) {
  const active = activeNavigations.get(tabId)
  if (
    !active ||
    active.token !== message.token ||
    active.correlationId !== message.correlationId ||
    active.gridKey !== message.gridKey
  ) {
    return
  }
  try {
    if (message.type === 'GRID_CHUNK') await uploadChunk(message)
    else if (message.type === 'GRID_DONE') await finishGrid(tabId, message.gridKey)
    else {
      activeNavigations.delete(tabId)
      await failSync(message.code, tabId)
    }
  } catch (error) {
    // A ordem de parar vem antes de tudo: antes do `delete`, que apaga o token
    // de que ela precisa, e antes de `failSync`, que num CLIENT_TOO_OLD pode
    // chamar `chrome.runtime.reload()` e matar este worker no meio. Um GRID_ERROR
    // não passa por aqui — ali o extrator já parou sozinho.
    await abortExtraction(tabId)
    activeNavigations.delete(tabId)
    await failSync(error instanceof Error ? error.message : 'UPLOAD_FAILED', tabId)
  }
}

function enqueueBridgeMessage(tabId: number, message: BridgeMessage) {
  const previous = tabQueues.get(tabId) ?? Promise.resolve()
  // Profundidade por aba, não só "existe fila". `tabQueues` guarda a promessa da
  // cadeia inteira, então enquanto `processBridgeMessage` roda a entrada dele
  // ainda está lá — perguntar "há fila?" de dentro dele responde sempre "sim".
  // Contando mensagens dá para descontar a que está falhando e ainda enxergar as
  // outras. Ver `nudgeUpdateIfSafe`.
  pendingBridgeMessages.set(tabId, (pendingBridgeMessages.get(tabId) ?? 0) + 1)
  const next = previous.then(() => processBridgeMessage(tabId, message))
  const queued = next.finally(() => {
    const remaining = (pendingBridgeMessages.get(tabId) ?? 1) - 1
    if (remaining > 0) pendingBridgeMessages.set(tabId, remaining)
    else pendingBridgeMessages.delete(tabId)
    if (tabQueues.get(tabId) === queued) tabQueues.delete(tabId)
  })
  tabQueues.set(tabId, queued)
}

async function retryPendingSync() {
  const state = await readSyncState()
  if (state.runId && currentStage(state) && state.status !== 'COMPLETED' && state.status !== 'ERROR') {
    await navigatePendingGrid()
    return { ok: true as const }
  }
  return startNewSync()
}

async function resumePending() {
  const state = await readSyncState()
  if (!state.runId || !currentStage(state) || state.status === 'COMPLETED' || state.status === 'ERROR') {
    return
  }
  const tab = await findNationalLifeTab()
  if (tab?.id !== undefined && tab.url) {
    await handleTabReady(tab.id, tab.url)
  } else {
    await navigatePendingGrid()
  }
}

async function getConnectorStatus() {
  const [device, sync] = await Promise.all([readDeviceState(), readSyncState()])
  return { ok: true as const, device, sync }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return
    const origin = requireAllowedBaseUrl(__KEEPR_ORIGIN__)
    void chrome.tabs.create({
      url: `${origin}/agent/integrations/national-life?connector=installed`,
    })
  })

  chrome.runtime.onMessageExternal.addListener((value, sender, sendResponse) => {
    if (!senderAllowed(sender)) {
      sendResponse({ ok: false, error: 'SENDER_NOT_ALLOWED' })
      return
    }
    const message = parseExternalMessage(value)
    if (!message) {
      sendResponse({ ok: false, error: 'INVALID_MESSAGE' })
      return
    }
    if (message.type === 'PAIR_CONNECTOR') {
      let baseOrigin: string
      try {
        baseOrigin = requireAllowedBaseUrl(message.baseUrl)
      } catch {
        sendResponse({ ok: false, error: 'BASE_URL_NOT_ALLOWED' })
        return
      }
      if (baseOrigin !== sender.origin) {
        sendResponse({ ok: false, error: 'BASE_URL_MISMATCH' })
        return
      }
      void pairConnector(message).then(sendResponse)
      return true
    }
    if (message.type === 'GET_CONNECTOR_STATUS') {
      void getConnectorStatus().then(sendResponse)
      return true
    }
    if (message.type === 'UNPAIR_CONNECTOR') {
      void unpairConnector().then(sendResponse)
      return true
    }
    void startNewSync().then(sendResponse)
    return true
  })

  chrome.runtime.onMessage.addListener((value, sender, sendResponse) => {
    const bridge = parseBridgeMessage(value)
    if (bridge && sender.tab?.id !== undefined && sender.url?.startsWith(`${NLG_ORIGIN}/agent/`)) {
      enqueueBridgeMessage(sender.tab.id, bridge)
      return
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      typeof (value as { type?: unknown }).type !== 'string'
    ) {
      return
    }
    const type = (value as { type: string }).type
    if (type === 'GET_STATUS' && Object.keys(value).length === 1) {
      void getConnectorStatus().then(sendResponse)
      return true
    }
    if (type === 'OPEN_NLG' && Object.keys(value).length === 1) {
      void (async () => {
        const state = await readSyncState()
        if (state.runId && currentStage(state) && state.status !== 'COMPLETED') {
          await navigatePendingGrid()
        } else {
          const tab = await findNationalLifeTab()
          if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { active: true })
          else await chrome.tabs.create({ url: `${NLG_ORIGIN}/agent/`, active: true })
        }
        sendResponse({ ok: true })
      })()
      return true
    }
    if (type === 'RETRY_SYNC' && Object.keys(value).length === 1) {
      void retryPendingSync().then(sendResponse)
      return true
    }
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') void handleTabReady(tabId, tab.url)
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeNavigations.delete(tabId)
    tabQueues.delete(tabId)
  })

  void resumePending()
  // Uma batida a cada subida do service worker. É a janela mais barata que existe
  // para uma flag chegar sem nenhuma ação do agente, e o worker sobe com muita
  // frequência justamente porque este conector acorda o tempo todo.
  //
  // Fora do caminho de ação de propósito: ninguém espera por ela, e o resultado
  // só é lido no próximo sync. Se falhar, o cache anterior continua valendo e o
  // endpoint segue sendo a autoridade — falhar aqui não pode parar nada.
  void (async () => {
    const device = await readDeviceState()
    if (device.status === 'READY' && device.baseUrl) {
      await ensureFreshRemoteConfig(device.baseUrl)
    }
  })()
})
