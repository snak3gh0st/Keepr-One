import { parseStagePlan, type StagePlan } from '../lib/capabilities'
import {
  CONNECTOR_SCHEMA_VERSION,
  CONNECTOR_VERSION_HEADER,
  readExtensionVersion,
} from '../lib/contract'
import {
  NLG_AUTH0_ORIGIN,
  NLG_ORIGIN,
  LOGIN_PATH,
  allowedKeeprOrigins,
  canonicalNationalLifeNavigatePath,
  isAuthPath,
  matchesNationalLifeStagePath,
  requireAllowedBaseUrl,
} from '../lib/constants'
import { clearDeviceKeys, getOrCreateDeviceKey } from '../lib/key-store'
import {
  parseBridgeMessage,
  parsePageCaptureAck,
  parseProbeAuthAck,
  parseExternalMessage,
  type AbortGridMessage,
  type BeginGridMessage,
  type BridgeControlAck,
  type BridgeMessage,
  type CapturePageMessage,
} from '../lib/messages'
import { chunkRecordsForUpload } from '../lib/record-chunks'
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

type ActiveNavigation = {
  type: 'BEGIN_GRID' | 'CAPTURE_PAGE'
  gridKey: string
  token: string
  correlationId: string
  tabId: number
  recordsTotal?: number
  lastSequence?: number
  truncated?: boolean
}

const activeNavigations = new Map<number, ActiveNavigation>()
const tabQueues = new Map<number, Promise<void>>()
/// Quantas mensagens da ponte estão pendentes por aba, incluindo a que está sendo
/// processada agora. `tabQueues` sozinho não distingue "uma mensagem, que sou eu"
/// de "uma mensagem minha e outras esperando".
const pendingBridgeMessages = new Map<number, number>()
let syncStartLock: Promise<unknown> | null = null

const BRIDGE_RETRY_DELAYS_MS = [150, 300, 600, 1_000, 1_500]
// O Chrome recusa qualquer alteração de aba durante um arrasto do usuário. É
// uma condição temporária do navegador, não uma falha da National Life nem do
// sync; a própria documentação do Chrome recomenda repetir a operação depois
// de uma espera curta.
const TAB_EDIT_RETRY_DELAYS_MS = [50, 100, 200, 400, 800]
const SYNC_WATCHDOG_ALARM = 'keeprone-national-life-sync-watchdog'

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isTabEditInProgress(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Tabs cannot be edited right now')
}

async function retryTabEdit<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= TAB_EDIT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const delay = TAB_EDIT_RETRY_DELAYS_MS[attempt]
      if (!isTabEditInProgress(error) || delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('TAB_EDIT_FAILED')
}

async function updateTab(tabId: number, updateProperties: chrome.tabs.UpdateProperties) {
  return retryTabEdit(() => chrome.tabs.update(tabId, updateProperties))
}

async function sendBeginGridWithRetry(tabId: number, message: BeginGridMessage): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage<BeginGridMessage, BridgeControlAck>(tabId, message)
      if (
        response?.ok !== true ||
        response.type !== 'BEGIN_GRID_ACK' ||
        response.gridKey !== message.gridKey ||
        response.token !== message.token ||
        response.correlationId !== message.correlationId
      ) {
        throw new Error('BRIDGE_UNAVAILABLE')
      }
      return
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
      const active = activeNavigations.get(tabId)
      if (!active || active.token !== message.token) return
    }
  }
  throw lastError ?? new Error('BRIDGE_UNAVAILABLE')
}

async function capturePageWithRetry(tabId: number, message: CapturePageMessage) {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = parsePageCaptureAck(await chrome.tabs.sendMessage(tabId, message))
      if (
        !response ||
        response.sourceKey !== message.sourceKey ||
        response.token !== message.token ||
        response.correlationId !== message.correlationId
      ) {
        throw new Error('BRIDGE_UNAVAILABLE')
      }
      return response.records
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
      const active = activeNavigations.get(tabId)
      if (!active || active.token !== message.token) break
    }
  }
  throw lastError ?? new Error('BRIDGE_UNAVAILABLE')
}

function respond<T>(sendResponse: (response?: T) => void, promise: Promise<T>): void {
  void promise.then(sendResponse, (error) => {
    sendResponse({ ok: false, error: errorCode(error, 'CONNECTOR_UNAVAILABLE') } as T)
  })
}

function versionedHeaders(base: Record<string, string>): Record<string, string> {
  const version = readExtensionVersion()
  return version ? { ...base, [CONNECTOR_VERSION_HEADER]: version } : base
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stageKey(stage: StagePlan): string {
  return stage.capability === 'READ_GRID' ? stage.params.gridKey : stage.params.sourceKey
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
  const tracked: Promise<unknown> = run.finally(() => {
    if (syncStartLock === tracked) syncStartLock = null
  })
  syncStartLock = tracked
  return run
}

async function hasAuthenticatedPortalSession(tabId: number): Promise<boolean> {
  const token = randomToken()
  const correlationId = crypto.randomUUID()
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = parseProbeAuthAck(await chrome.tabs.sendMessage(tabId, {
        type: 'PROBE_AUTH',
        token,
        correlationId,
      }))
      if (
        !response ||
        response.token !== token ||
        response.correlationId !== correlationId
      ) {
        throw new Error('BRIDGE_UNAVAILABLE')
      }
      return response.authenticated
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('BRIDGE_UNAVAILABLE')
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
  await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
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
  await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
  if (revokesDevice(code)) await forgetRevokedDevice()
  // O servidor afirmou que esta versão não serve mais. É o único gatilho: um
  // empurrão a cada falha genérica gastaria as tentativas contra problemas que
  // atualizar não resolve. `failSync` já gravou o ERROR, e o estado de sync
  // acabou de sair dos estados ocupados — por isso o empurrão vem depois.
  if (OUTDATED_CODES.includes(code)) await nudgeUpdateIfSafe(selfTabId)
}

async function createRun() {
  const previous = await readSyncState()
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
  if (
    !remote.syncEnabled ||
    remote.disabledCapabilities.includes('READ_GRID') ||
    !remote.executableCapabilities.includes('READ_GRID')
  ) {
    throw new Error('CONNECTOR_PAUSED')
  }
  await writeSyncState({ ...previous, status: 'STARTING', errorCode: undefined })
  const response = await signedJsonRequest<{ runId?: unknown; stages?: unknown; completedStages?: unknown }>({
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
  const completedStages = typeof response.completedStages === 'number' &&
    Number.isInteger(response.completedStages) &&
    response.completedStages >= 0 &&
    response.completedStages < plan.length
    ? response.completedStages
    : 0
  if (previous.runId === response.runId && currentStage(previous)) {
    // A retry of a still-live run must resume from the server-confirmed cursor.
    // Local storage can be stale when Chrome evicts the worker between a grid
    // acknowledgement and the following navigation.
    await writeSyncState({
      ...previous,
      runId: response.runId,
      plan,
      stageIndex: completedStages,
      status: 'NAVIGATING',
      errorCode: undefined,
    })
  } else {
    await writeSyncState({
      runId: response.runId,
      plan,
      stageIndex: 0,
      status: 'NAVIGATING',
      carrierTabId: previous.carrierTabId,
    })
  }
  chrome.alarms.create(SYNC_WATCHDOG_ALARM, { periodInMinutes: 1 })
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
  const usableTabs = carrierTabs.filter((tab) => typeof tab.id === 'number')
  return usableTabs.find((tab) => !tab.active) ?? usableTabs.find((tab) => tab.active) ?? usableTabs[0]
}

async function findConnectorTab(state: Awaited<ReturnType<typeof readSyncState>>) {
  if (typeof state.carrierTabId !== 'number') return undefined
  const tabs = await chrome.tabs.query({
    url: [`${NLG_ORIGIN}/*`, `${NLG_AUTH0_ORIGIN}/*`],
  })
  return tabs.find((tab) => tab.id === state.carrierTabId)
}

async function navigatePendingGrid() {
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !stage) return
  const gridKey = stageKey(stage)
  const targetPath = canonicalNationalLifeNavigatePath(gridKey, stage.params.navigatePath)
  const target = `${NLG_ORIGIN}${targetPath}`
  const existing = await findConnectorTab(state)
  if (existing?.id !== undefined && existing.url) {
    try {
      if (isAuthPath(new URL(existing.url).pathname)) {
        await writeSyncState({ ...state, status: 'AUTH_REQUIRED', errorCode: undefined })
        await updateTab(existing.id, { active: true })
        return
      }
    } catch {
      // Fall through to the normal target navigation for an unparseable tab URL.
    }
  }
  await writeSyncState({ ...state, status: 'NAVIGATING', errorCode: undefined })
  if (existing?.id !== undefined) {
    // A logged-in portal tab is an implementation detail of the connector. Do
    // not steal focus from Keepr One or from the agent's other work. The only
    // time we intentionally activate a tab is when the agent must complete
    // National Life login/MFA above.
    const existingPath = existing.url ? new URL(existing.url).pathname : undefined
    if (
      existingPath &&
      matchesNationalLifeStagePath(gridKey, stage.params.navigatePath, existingPath)
    ) {
      // `Check again` can be pressed while the expected grid is already open.
      // There is no tabs.onUpdated event in that case, so explicitly resume the
      // bridge or the run would remain in NAVIGATING forever.
      await handleTabReady(existing.id, existing.url)
      return
    }
    if (existing.active) {
      // The agent may be using the visible carrier tab. Keep it untouched and
      // bind the one quiet connector tab we create; without retaining this id,
      // every later resume mistakes it for missing and opens another tab.
      const created = await chrome.tabs.create({ active: false, url: target })
      if (created?.id !== undefined) {
        await writeSyncState({
          ...(await readSyncState()),
          carrierTabId: created.id,
          status: 'NAVIGATING',
          errorCode: undefined,
        })
      }
    } else {
      await updateTab(existing.id, { url: target })
    }
  } else {
    const created = await chrome.tabs.create({
      active: state.status === 'AUTH_REQUIRED',
      url: target,
    })
    if (created?.id !== undefined) {
      await writeSyncState({
        ...(await readSyncState()),
        carrierTabId: created.id,
        status: 'NAVIGATING',
        errorCode: undefined,
      })
    }
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
        // Re-enter the signed start endpoint. It reuses a live run, but first
        // expires a dead one; the response handling above preserves the cursor
        // for the live case and starts at stage zero for a reclaimed run.
        await createRun()
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

async function beginExtraction(tabId: number, stage: StagePlan) {
  const gridKey = stageKey(stage)
  const active = activeNavigations.get(tabId)
  if (active?.gridKey === gridKey) {
    const state = await readSyncState()
    if (state.status === 'EXTRACTING' || state.status === 'UPLOADING') return
    // A retry deliberately moved the persisted state back to NAVIGATING. The
    // old in-memory token belongs to the failed attempt and must not prevent a
    // fresh BEGIN_GRID from reaching the bridge.
    activeNavigations.delete(tabId)
  }
  const token = randomToken()
  const correlationId = crypto.randomUUID()
  const message = {
    type: stage.capability === 'READ_GRID' ? 'BEGIN_GRID' as const : 'CAPTURE_PAGE' as const,
    gridKey,
    token,
    correlationId,
  }
  activeNavigations.set(tabId, { ...message, tabId })
  await writeSyncState({ ...(await readSyncState()), status: 'EXTRACTING', errorCode: undefined })
  try {
    // `tabs.onUpdated(..., complete)` can arrive a few hundred milliseconds
    // before the document_start bridge has registered its listener. Treat that
    // race as a page-readiness delay, not as a failed sync.
    if (stage.capability === 'READ_GRID') {
      await sendBeginGridWithRetry(tabId, {
        type: 'BEGIN_GRID',
        gridKey,
        token,
        correlationId,
      })
      return
    }

    const records = await capturePageWithRetry(tabId, {
      type: 'CAPTURE_PAGE',
      sourceKey: gridKey,
      token,
      correlationId,
    })
    const chunks = chunkRecordsForUpload(records)
    for (const [sequence, chunk] of chunks.entries()) {
      await uploadChunk(tabId, {
        type: 'GRID_CHUNK',
        gridKey,
        token,
        correlationId,
        sequence,
        recordsTotal: records.length,
        truncated: false,
        records: chunk,
      })
    }
    await finishGrid(tabId, gridKey)
  } catch (error) {
    activeNavigations.delete(tabId)
    await failSync(errorCode(error, 'BRIDGE_UNAVAILABLE'))
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
  const state = await readSyncState()
  if (state.carrierTabId !== tabId) return
  const stage = currentStage(state)
  if (!state.runId || !stage || state.status === 'COMPLETED' || state.status === 'ERROR') {
    return
  }
  if (url.origin === NLG_AUTH0_ORIGIN) {
    await writeSyncState({ ...state, status: 'AUTH_REQUIRED', errorCode: undefined })
    await updateTab(tabId, { active: true })
    return
  }
  if (url.origin !== NLG_ORIGIN) return
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
  const gridKey = stageKey(stage)
  if (!matchesNationalLifeStagePath(gridKey, stage.params.navigatePath, url.pathname)) {
    // Auth interstitials are handled above. For any other carrier page, resume
    // the stage in a background tab; otherwise a stale tab (for example
    // All Clients left open after the previous stage) strands the run in
    // NAVIGATING forever.
    if (state.status !== 'AUTH_REQUIRED') {
      await navigatePendingGrid()
    }
    return
  }
  // A carrier URL alone is not proof of a carrier session: stale callbacks and
  // login interstitials have both appeared under `/agent/*`. Ask the isolated
  // bridge to make one credentialed, non-following request to the agent shell.
  // A redirect to Auth0 is then an explicit negative instead of a page-shape
  // guess, and no extraction begins until this succeeds.
  if (!(await hasAuthenticatedPortalSession(tabId))) {
    await writeSyncState({ ...state, status: 'AUTH_REQUIRED', errorCode: undefined })
    await updateTab(tabId, { active: true, url: `${NLG_ORIGIN}${LOGIN_PATH}` })
    return
  }
  await beginExtraction(tabId, stage)
}

async function uploadChunk(tabId: number, message: Extract<BridgeMessage, { type: 'GRID_CHUNK' }>) {
  const device = await readDeviceState()
  const state = await readSyncState()
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !state.runId ||
    state.runId.length > 128 ||
    !currentStage(state) || stageKey(currentStage(state)!) !== message.gridKey
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
  const active = activeNavigations.get(tabId)
  if (active && active.token === message.token && active.correlationId === message.correlationId) {
    activeNavigations.set(tabId, {
      ...active,
      recordsTotal: message.recordsTotal,
      lastSequence: message.sequence,
      truncated: message.truncated,
    })
  }
}

async function finishGrid(tabId: number, gridKey: string) {
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !state.plan || !stage || stageKey(stage) !== gridKey) {
    throw new Error('SYNC_STATE_INVALID')
  }
  const active = activeNavigations.get(tabId)
  if (
    !active ||
    active.gridKey !== gridKey ||
    active.recordsTotal === undefined ||
    active.lastSequence === undefined ||
    active.truncated === undefined
  ) {
    throw new Error('STAGE_COMPLETION_INVALID')
  }
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    throw new Error('SYNC_STATE_INVALID')
  }
  await signedJsonRequest({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/stages/${encodeURIComponent(gridKey)}/complete`,
    idempotencyKey: `nlc:${state.runId}:${state.stageIndex ?? 0}:${gridKey}:complete:${active.lastSequence}`,
    body: {
      runId: state.runId,
      gridKey,
      expectedRecordCount: active.recordsTotal,
      finalSequence: active.lastSequence,
      truncated: active.truncated,
    },
  })
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
    await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
    return
  }
  await writeSyncState({
    runId: state.runId,
    plan,
    stageIndex: nextIndex,
    status: 'NAVIGATING',
    uploads: state.uploads,
  })
  const nextGridKey = stageKey(next)
  const nextPath = canonicalNationalLifeNavigatePath(nextGridKey, next.params.navigatePath)
  await updateTab(tabId, { url: `${NLG_ORIGIN}${nextPath}` })
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
    if (message.type === 'GRID_CHUNK') await uploadChunk(tabId, message)
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

function enqueueBridgeMessage(tabId: number, message: BridgeMessage): Promise<void> {
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
  return queued
}

async function retryPendingSync() {
  return startNewSync()
}

async function resumePending(options?: { reconcileWithServer?: boolean }) {
  const state = await readSyncState()
  if (!state.runId || !currentStage(state) || state.status === 'COMPLETED' || state.status === 'ERROR') {
    return
  }
  if (state.status === 'AUTH_REQUIRED') {
    // Login and MFA are user-paced. Polling the run-start endpoint while the
    // agent is typing consumes the server's retry budget and eventually turns a
    // healthy pairing into a deterministic 429. Stay completely passive until
    // the carrier tab itself leaves the authentication flow.
    const authTab = await findConnectorTab(state)
    if (!authTab?.url || authTab.id === undefined) return
    try {
      const authUrl = new URL(authTab.url)
      if (authUrl.origin === NLG_AUTH0_ORIGIN || isAuthPath(authUrl.pathname)) return
    } catch {
      return
    }
    await handleTabReady(authTab.id, authTab.url)
    return
  }
  // The server is the durable cursor. A service worker may be evicted after it
  // confirms a grid and before it moves the tab to the next one.
  if (
    options?.reconcileWithServer &&
    state.status === 'UPLOADING' &&
    activeNavigations.size === 0
  ) {
    await createRun()
  }
  const resumed = await readSyncState()
  if (!resumed.runId || !currentStage(resumed) || resumed.status === 'COMPLETED' || resumed.status === 'ERROR') {
    return
  }
  const tab = await findConnectorTab(resumed)
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
      respond(sendResponse, pairConnector(message))
      return true
    }
    if (message.type === 'GET_CONNECTOR_STATUS') {
      respond(sendResponse, getConnectorStatus())
      return true
    }
    if (message.type === 'UNPAIR_CONNECTOR') {
      respond(sendResponse, unpairConnector())
      return true
    }
    respond(sendResponse, startNewSync())
    return true
  })

  chrome.runtime.onMessage.addListener((value, sender, sendResponse) => {
    const bridge = parseBridgeMessage(value)
    if (bridge && sender.tab?.id !== undefined && sender.url?.startsWith(`${NLG_ORIGIN}/agent/`)) {
      respond(sendResponse, enqueueBridgeMessage(sender.tab.id, bridge).then(() => ({ ok: true as const })))
      return true
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
      respond(sendResponse, getConnectorStatus())
      return true
    }
    if (type === 'OPEN_NLG' && Object.keys(value).length === 1) {
      respond(
        sendResponse,
        (async () => {
          const state = await readSyncState()
          if (state.runId && currentStage(state) && state.status !== 'COMPLETED') {
            await navigatePendingGrid()
          } else {
            const tab = await findNationalLifeTab()
            if (tab?.id !== undefined) await updateTab(tab.id, { active: true })
            else await chrome.tabs.create({ url: `${NLG_ORIGIN}/agent/`, active: true })
          }
          return { ok: true as const }
        })(),
      )
      return true
    }
    if (type === 'RETRY_SYNC' && Object.keys(value).length === 1) {
      respond(sendResponse, retryPendingSync())
      return true
    }
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
      void handleTabReady(tabId, tab.url).catch((error) =>
        failSync(errorCode(error, 'TAB_EDIT_FAILED')),
      )
    }
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeNavigations.delete(tabId)
    tabQueues.delete(tabId)
    // A visible Chrome tab is not a disposable implementation detail. The agent
    // closing it is an explicit stop signal, not permission to keep reopening
    // National Life behind their back. End this run cleanly; a later Sync starts
    // a new, inactive carrier tab only when the agent asks for it.
    void (async () => {
      const state = await readSyncState()
      if (state.carrierTabId !== tabId) return
      if (state.status === 'COMPLETED' || state.status === 'ERROR' || !state.runId || !currentStage(state)) {
        return
      }
      await writeSyncState({ ...state, carrierTabId: undefined })
      await failSync('CONNECTOR_TAB_CLOSED')
    })().catch(() => failSync('CONNECTOR_TAB_CLOSED'))
  })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SYNC_WATCHDOG_ALARM) return
    void resumePending({ reconcileWithServer: true }).catch((error) => failSync(errorCode(error, 'SYNC_RESUME_FAILED')))
  })

  void (async () => {
    const state = await readSyncState()
    // If Chrome evicted us after the server accepted GRID_DONE, storage still
    // says UPLOADING even though the server has already advanced the durable
    // cursor. Reconcile immediately on this recovery path; waiting for a user
    // click or the next alarm would turn a recoverable hand-off into a stall.
    await resumePending({ reconcileWithServer: state.status === 'UPLOADING' })
  })().catch((error) => failSync(errorCode(error, 'SYNC_RESUME_FAILED')))
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
