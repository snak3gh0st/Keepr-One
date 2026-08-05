import { parseStagePlan } from '../lib/capabilities'
import { CONNECTOR_SCHEMA_VERSION } from '../lib/contract'
import {
  NLG_ORIGIN,
  allowedKeeprOrigins,
  isAuthPath,
  requireAllowedBaseUrl,
} from '../lib/constants'
import { clearDeviceKeys, getOrCreateDeviceKey } from '../lib/key-store'
import {
  parseBridgeMessage,
  parseExternalMessage,
  type BeginGridMessage,
  type BridgeMessage,
} from '../lib/messages'
import { revokesDevice } from '../lib/failure'
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
let syncStartLock: Promise<unknown> | null = null

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
        headers: { 'content-type': 'application/json' },
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
async function failSync(code: string) {
  await writeSyncState({ ...(await readSyncState()), status: 'ERROR', errorCode: code })
  await reportRunFailure(code)
  if (revokesDevice(code)) await forgetRevokedDevice()
}

async function createRun() {
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    throw new Error('CONNECTOR_NOT_PAIRED')
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
  const tabs = await chrome.tabs.query({ url: `${NLG_ORIGIN}/*` })
  return tabs.find((tab) => typeof tab.id === 'number' && tab.active) ?? tabs.find((tab) => typeof tab.id === 'number')
}

async function navigatePendingGrid() {
  const state = await readSyncState()
  const stage = currentStage(state)
  if (!state.runId || !stage) return
  const target = `${NLG_ORIGIN}${stage.params.navigatePath}`
  const existing = await findNationalLifeTab()
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
      await failSync(message.code)
    }
  } catch (error) {
    activeNavigations.delete(tabId)
    await failSync(error instanceof Error ? error.message : 'UPLOAD_FAILED')
  }
}

function enqueueBridgeMessage(tabId: number, message: BridgeMessage) {
  const previous = tabQueues.get(tabId) ?? Promise.resolve()
  const next = previous.then(() => processBridgeMessage(tabId, message))
  const queued = next.finally(() => {
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
})
