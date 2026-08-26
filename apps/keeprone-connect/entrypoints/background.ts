import {
  parseConnectorCommandDispatch,
  parseStagePlan,
  type ConnectorCommandDispatch,
  type StagePlan,
} from '../lib/capabilities'
import {
  CONNECTOR_COMMAND_PROTOCOL_VERSION,
  type ConnectorCommandEventType,
} from '../lib/command-contract'
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
  parseCapturePolicyDetailAck,
  parsePageCaptureAck,
  parseProbeAuthAck,
  parseExternalMessage,
  type AbortGridMessage,
  type BeginGridMessage,
  type BridgeControlAck,
  type BridgeMessage,
  type CapturePageMessage,
  type CapturePolicyDetailMessage,
  type BeginExportMessage,
  type BeginDocumentMessage,
  type DocumentControlAck,
} from '../lib/messages'
import { chunkRecordsForUpload } from '../lib/record-chunks'
import {
  parseCommissionDetailResume,
  parseCommissionDetailTargets,
  type CommissionDetailTarget,
} from '../lib/commission-detail'
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
import { SignedRequestError, signedBinaryRequest, signedJsonRequest } from '../lib/signed-client'
import {
  parseForesightIllustrationSnapshot,
  sha256ForesightSnapshot,
} from '../lib/foresight-contract'
import {
  parseForesightExecutionResponse,
  type ExecuteForesightIllustrationMessage,
  type ForesightExecutionResponse,
} from '../lib/foresight-messages'
import {
  currentStage,
  readCommandState,
  readDeviceState,
  readSyncState,
  writeDeviceState,
  writeCommandState,
  writeSyncState,
} from '../lib/state'

type ActiveNavigation = {
  type: 'BEGIN_GRID' | 'CAPTURE_PAGE' | 'BEGIN_EXPORT'
  gridKey: string
  token: string
  correlationId: string
  tabId: number
  recordsTotal?: number
  lastSequence?: number
  truncated?: boolean
  exportUploadId?: string
  exportNextSequence?: number
  detailStatementId?: string
}

const activeNavigations = new Map<number, ActiveNavigation>()
type DocumentFetchResult = { ok: true; documentId: string } | { ok: false; error: string }
type ActiveDocument = {
  transferId: string
  token: string
  correlationId: string
  tabId: number
  nextSequence: number
  resolve: (result: DocumentFetchResult) => void
  timer: ReturnType<typeof setTimeout>
}
const activeDocuments = new Map<number, ActiveDocument>()
let documentFetchLock = false
const tabQueues = new Map<number, Promise<void>>()
/// Quantas mensagens da ponte estão pendentes por aba, incluindo a que está sendo
/// processada agora. `tabQueues` sozinho não distingue "uma mensagem, que sou eu"
/// de "uma mensagem minha e outras esperando".
const pendingBridgeMessages = new Map<number, number>()
let syncStartLock: Promise<unknown> | null = null
let tabNavigationLock: Promise<unknown> | null = null
let commandPollLock: Promise<unknown> | null = null
const tabReadyLocks = new Map<number, Promise<void>>()

const BRIDGE_RETRY_DELAYS_MS = [150, 300, 600, 1_000, 1_500]
// O Chrome recusa qualquer alteração de aba durante um arrasto do usuário. É
// uma condição temporária do navegador, não uma falha da National Life nem do
// sync; a própria documentação do Chrome recomenda repetir a operação depois
// de uma espera curta.
const TAB_EDIT_RETRY_DELAYS_MS = [50, 100, 200, 400, 800]
const SYNC_WATCHDOG_ALARM = 'keeprone-national-life-sync-watchdog'
const SCHEDULED_SYNC_ALARM = 'keeprone-national-life-scheduled-sync'
const COMMAND_POLL_ALARM = 'keeprone-national-life-command-poll'
const COMMAND_POLL_PERIOD_MINUTES = 1
const SCHEDULED_SYNC_PERIOD_MINUTES = 15
const SCHEDULED_SYNC_FRESH_MS = 24 * 60 * 60_000
// One navigation can legitimately start from the previous grid. A second
// redirect can be the carrier's canonical route. If that canonical route still
// does not match, a third trip would be a loop, so isolate the source instead.
const MAX_STAGE_NAVIGATION_ATTEMPTS = 2

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

async function capturePolicyDetailWithRetry(
  tabId: number,
  message: CapturePolicyDetailMessage,
) {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = parseCapturePolicyDetailAck(await chrome.tabs.sendMessage(tabId, message))
      if (
        !response ||
        response.token !== message.token ||
        response.correlationId !== message.correlationId ||
        response.detail.navigatePath !== message.navigatePath ||
        response.detail.expectedPolicyNumber !== message.expectedPolicyNumber
      ) throw new Error('BRIDGE_UNAVAILABLE')
      return response.detail
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
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

function isCommissionDetailStage(stage: StagePlan | undefined): boolean {
  return stage?.capability === 'READ_GRID' &&
    stage.params.gridKey === 'COMMISSIONS_EARNING_REPORT' &&
    stage.params.mode === 'COMMISSION_DETAILS'
}

function commissionDetailTarget(
  state: Awaited<ReturnType<typeof readSyncState>>,
): CommissionDetailTarget | undefined {
  if (!state.commissionDetailLinks) return undefined
  try {
    const links = parseCommissionDetailTargets({ links: state.commissionDetailLinks })
    return links[state.commissionDetailIndex ?? 0]
  } catch {
    return undefined
  }
}

function stageTargetPath(
  state: Awaited<ReturnType<typeof readSyncState>>,
  stage: StagePlan,
): string {
  const detail = commissionDetailTarget(state)
  if (isCommissionDetailStage(stage) && detail) return detail.path
  return canonicalNationalLifeNavigatePath(stageKey(stage), stage.params.navigatePath)
}

async function sendBeginExportWithRetry(tabId: number, message: BeginExportMessage): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage<BeginExportMessage, BridgeControlAck>(tabId, message)
      if (response?.ok !== true || response.type !== 'BEGIN_EXPORT_ACK' ||
        response.gridKey !== message.sourceKey || response.token !== message.token ||
        response.correlationId !== message.correlationId) throw new Error('BRIDGE_UNAVAILABLE')
      return
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('BRIDGE_UNAVAILABLE')
}

async function sendBeginDocumentWithRetry(tabId: number, message: BeginDocumentMessage): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage<BeginDocumentMessage, DocumentControlAck>(tabId, message)
      if (response?.ok !== true || response.type !== 'BEGIN_DOCUMENT_ACK' ||
        response.transferId !== message.transferId || response.token !== message.token ||
        response.correlationId !== message.correlationId) throw new Error('BRIDGE_UNAVAILABLE')
      return
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('BRIDGE_UNAVAILABLE')
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
  // `run` is the promise returned to the caller; `tracked` exists only so the
  // next entrant can wait for cleanup. Observe its mirrored rejection too, or
  // Chrome reports an unhandled rejection even when the caller catches `run`.
  void tracked.catch(() => {})
  return run
}

async function withTabNavigationLock<T>(operation: () => Promise<T>): Promise<T> {
  while (tabNavigationLock) {
    try {
      await tabNavigationLock
    } catch {
      // A failed navigation must not strand the next recovery attempt.
    }
  }
  const run = operation()
  const tracked: Promise<unknown> = run.finally(() => {
    if (tabNavigationLock === tracked) tabNavigationLock = null
  })
  tabNavigationLock = tracked
  void tracked.catch(() => {})
  return run
}

async function withTabReadyLock(tabId: number, operation: () => Promise<void>): Promise<void> {
  const previous = tabReadyLocks.get(tabId)
  if (previous) {
    try {
      await previous
    } catch {
      // The previous page event already recorded its failure.
    }
  }
  const run = operation()
  const tracked = run.finally(() => {
    if (tabReadyLocks.get(tabId) === tracked) tabReadyLocks.delete(tabId)
  })
  tabReadyLocks.set(tabId, tracked)
  void tracked.catch(() => {})
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
    // Scheduling is best-effort. The device is already paired at this point;
    // an unavailable alarms API must not turn a valid pairing into ERROR.
    void ensureScheduledSyncAlarm().catch(() => {})
    void ensureCommandPollAlarm().catch(() => {})
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
  await writeCommandState({ status: 'IDLE' })
  activeNavigations.clear()
  for (const active of activeDocuments.values()) {
    clearTimeout(active.timer)
    active.resolve({ ok: false, error: 'CONNECTOR_UNPAIRED' })
  }
  activeDocuments.clear()
  tabQueues.clear()
  await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
  await chrome.alarms.clear(SCHEDULED_SYNC_ALARM)
  await chrome.alarms.clear(COMMAND_POLL_ALARM)
  return { ok: true as const, deviceId: device.deviceId }
}

function scheduledSyncIsDue(
  device: Awaited<ReturnType<typeof readDeviceState>>,
  sync: Awaited<ReturnType<typeof readSyncState>>,
  now = Date.now(),
): boolean {
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) return false
  if (!['IDLE', 'COMPLETED', 'PARTIAL'].includes(sync.status)) return false
  if (!sync.completedAt) return true
  const completedAt = Date.parse(sync.completedAt)
  return !Number.isFinite(completedAt) || now - completedAt >= SCHEDULED_SYNC_FRESH_MS
}

async function ensureScheduledSyncAlarm() {
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    await chrome.alarms.clear(SCHEDULED_SYNC_ALARM)
    return
  }
  const existing = await chrome.alarms.get(SCHEDULED_SYNC_ALARM)
  if (existing) return
  chrome.alarms.create(SCHEDULED_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: SCHEDULED_SYNC_PERIOD_MINUTES,
  })
}

async function startScheduledSyncIfDue() {
  const [device, sync] = await Promise.all([readDeviceState(), readSyncState()])
  if (!scheduledSyncIsDue(device, sync)) return
  await startNewSync()
}

async function ensureCommandPollAlarm() {
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    await chrome.alarms.clear(COMMAND_POLL_ALARM)
    return
  }
  const existing = await chrome.alarms.get(COMMAND_POLL_ALARM)
  if (existing) return
  chrome.alarms.create(COMMAND_POLL_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: COMMAND_POLL_PERIOD_MINUTES,
  })
}

async function findBoundCommandTab(
  carrierTabId: number | undefined,
  hint?: chrome.tabs.Tab,
): Promise<chrome.tabs.Tab | undefined> {
  if (typeof carrierTabId !== 'number') return undefined
  if (hint?.id === carrierTabId) return hint
  const tabs = await chrome.tabs.query({
    url: [`${NLG_ORIGIN}/*`, `${NLG_AUTH0_ORIGIN}/*`],
  })
  return tabs.find((tab) => tab.id === carrierTabId)
}

async function postCommandEvent(input: {
  dispatch: ConnectorCommandDispatch
  device: { deviceId: string; baseUrl: string }
  sequence: number
  type: ConnectorCommandEventType
  payload?: Record<string, unknown> | null
  error?: { code: string; safeMessage: string } | null
}): Promise<number> {
  const event = {
    protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
    eventId: crypto.randomUUID(),
    commandId: input.dispatch.command.commandId,
    runId: input.dispatch.command.runId,
    sequence: input.sequence,
    type: input.type,
    emittedAt: new Date().toISOString(),
    payload: input.payload ?? null,
    error: input.error ?? null,
  }
  await signedJsonRequest({
    baseUrl: input.device.baseUrl,
    deviceId: input.device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/commands/${encodeURIComponent(input.dispatch.command.commandId)}/events`,
    body: event,
  })
  const nextEventSequence = input.sequence + 1
  await writeCommandState({
    ...(await readCommandState()),
    nextEventSequence,
    updatedAt: new Date().toISOString(),
  })
  return nextEventSequence
}

async function executePolicyDetailCommand(
  dispatch: ConnectorCommandDispatch,
  device: { deviceId: string; baseUrl: string },
  hint?: chrome.tabs.Tab,
) {
  if (dispatch.command.capability !== 'READ_POLICY_DETAIL') throw new Error('UNKNOWN_CAPABILITY')
  const params = dispatch.command.params
  if (!('navigatePath' in params) || !('policyNumber' in params)) throw new Error('INVALID_COMMAND')

  const previous = await readCommandState()
  const sameCommand = previous.commandId === dispatch.command.commandId
  let carrierTabId = sameCommand ? previous.carrierTabId : undefined
  let sequence = dispatch.nextEventSequence
  await writeCommandState({
    commandId: dispatch.command.commandId,
    runId: dispatch.command.runId,
    carrierTabId,
    nextEventSequence: sequence,
    status: 'NAVIGATING',
    updatedAt: new Date().toISOString(),
  })

  const targetUrl = `${NLG_ORIGIN}${params.navigatePath}`
  const tab = await findBoundCommandTab(carrierTabId, hint)
  if (!tab?.id) {
    const created = await chrome.tabs.create({ active: false, url: targetUrl })
    if (created.id === undefined) throw new Error('COMMAND_TAB_UNAVAILABLE')
    carrierTabId = created.id
    await writeCommandState({
      ...(await readCommandState()),
      carrierTabId,
      status: 'NAVIGATING',
      updatedAt: new Date().toISOString(),
    })
    return
  }
  carrierTabId = tab.id

  let currentUrl: URL
  try {
    currentUrl = new URL(tab.url ?? '')
  } catch {
    await updateTab(tab.id, { url: targetUrl })
    return
  }
  if (currentUrl.origin === NLG_AUTH0_ORIGIN || isAuthPath(currentUrl.pathname)) {
    const requirement = currentUrl.pathname.includes('/mfa') || currentUrl.pathname.includes('/challenge')
      ? 'MFA_REQUIRED' as const
      : 'AUTH_REQUIRED' as const
    if (dispatch.lastEventType !== requirement) {
      sequence = await postCommandEvent({
        dispatch, device, sequence, type: requirement,
        payload: { action: 'SIGN_IN_TO_CONTINUE' },
      })
    }
    await writeCommandState({
      ...(await readCommandState()), carrierTabId: tab.id, nextEventSequence: sequence,
      status: requirement, updatedAt: new Date().toISOString(),
    })
    if (!tab.active) await updateTab(tab.id, { active: true })
    return
  }
  if (`${currentUrl.pathname}${currentUrl.search}` !== params.navigatePath) {
    await updateTab(tab.id, { url: targetUrl })
    return
  }
  if (!(await hasAuthenticatedPortalSession(tab.id))) {
    if (dispatch.lastEventType !== 'AUTH_REQUIRED') {
      sequence = await postCommandEvent({
        dispatch, device, sequence, type: 'AUTH_REQUIRED',
        payload: { action: 'SIGN_IN_TO_CONTINUE' },
      })
    }
    await writeCommandState({
      ...(await readCommandState()), carrierTabId: tab.id, nextEventSequence: sequence,
      status: 'AUTH_REQUIRED', updatedAt: new Date().toISOString(),
    })
    await updateTab(tab.id, { active: true, url: `${NLG_ORIGIN}${LOGIN_PATH}` })
    return
  }

  await writeCommandState({
    ...(await readCommandState()), carrierTabId: tab.id, status: 'RUNNING',
    updatedAt: new Date().toISOString(),
  })
  if (dispatch.lastEventType !== 'COMMAND_STARTED' && dispatch.lastEventType !== 'DATA_BATCH') {
    sequence = await postCommandEvent({ dispatch, device, sequence, type: 'COMMAND_STARTED' })
  }
  if (dispatch.lastEventType !== 'DATA_BATCH') {
    const token = randomToken()
    const correlationId = crypto.randomUUID()
    const detail = await capturePolicyDetailWithRetry(tab.id, {
      type: 'CAPTURE_POLICY_DETAIL',
      expectedPolicyNumber: params.policyNumber,
      navigatePath: params.navigatePath,
      token,
      correlationId,
    })
    sequence = await postCommandEvent({
      dispatch,
      device,
      sequence,
      type: 'DATA_BATCH',
      payload: { policyDetail: detail },
    })
  }
  sequence = await postCommandEvent({
    dispatch,
    device,
    sequence,
    type: 'COMMAND_COMPLETED',
    payload: { result: 'POLICY_DETAIL_SYNCED' },
  })
  await writeCommandState({
    commandId: dispatch.command.commandId,
    runId: dispatch.command.runId,
    carrierTabId: tab.id,
    nextEventSequence: sequence,
    status: 'COMPLETED',
    updatedAt: new Date().toISOString(),
  })
}

function parseForesightCommandInput(value: unknown): {
  inputHash: string
  snapshot: NonNullable<ReturnType<typeof parseForesightIllustrationSnapshot>>
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FORESIGHT_INPUT_INVALID')
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.inputHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.inputHash)) throw new Error('FORESIGHT_INPUT_INVALID')
  const snapshot = parseForesightIllustrationSnapshot(record.snapshot)
  if (!snapshot) throw new Error('FORESIGHT_INPUT_INVALID')
  return { inputHash: record.inputHash, snapshot }
}

async function decodeForesightPdf(response: Extract<ForesightExecutionResponse, { ok: true }>): Promise<Uint8Array> {
  let binary: string
  try {
    binary = atob(response.document.pdfBase64)
  } catch {
    throw new Error('FORESIGHT_REPORT_RESPONSE_INVALID')
  }
  if (binary.length !== response.receipt.documentBytes || !binary.startsWith('%PDF-')) {
    throw new Error('FORESIGHT_REPORT_RESPONSE_INVALID')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (hash !== response.receipt.documentSha256) throw new Error('FORESIGHT_REPORT_HASH_MISMATCH')
  return bytes
}

async function uploadForesightArtifact(input: {
  dispatch: ConnectorCommandDispatch
  device: { deviceId: string; baseUrl: string }
  response: Extract<ForesightExecutionResponse, { ok: true }>
}): Promise<void> {
  const bytes = await decodeForesightPdf(input.response)
  let lastError: unknown
  for (const delay of [0, 500, 1_500]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      const stored = await signedBinaryRequest<{ documentSha256?: unknown; documentBytes?: unknown }>({
        baseUrl: input.device.baseUrl,
        deviceId: input.device.deviceId,
        method: 'PUT',
        pathname: `/api/agent/integrations/national-life/local-connector/commands/${encodeURIComponent(input.dispatch.command.commandId)}/artifact`,
        contentType: 'application/pdf',
        body: bytes,
      })
      if (stored.documentSha256 !== input.response.receipt.documentSha256 ||
        stored.documentBytes !== input.response.receipt.documentBytes) {
        throw new Error('FORESIGHT_ARTIFACT_RECEIPT_MISMATCH')
      }
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('FORESIGHT_ARTIFACT_UPLOAD_FAILED')
}

async function sendForesightExecution(
  tabId: number,
  message: ExecuteForesightIllustrationMessage,
): Promise<ForesightExecutionResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt <= BRIDGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message)
      return parseForesightExecutionResponse(response, message)
    } catch (error) {
      lastError = error
      const delay = BRIDGE_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError ?? new Error('FORESIGHT_BRIDGE_UNAVAILABLE')
}

async function executeForesightCommand(
  dispatch: ConnectorCommandDispatch,
  device: { deviceId: string; baseUrl: string },
  hint?: chrome.tabs.Tab,
) {
  if (dispatch.command.capability !== 'GENERATE_ILLUSTRATION') throw new Error('UNKNOWN_CAPABILITY')
  const params = dispatch.command.params
  if (!('illustrationId' in params) || !('inputHash' in params)) throw new Error('INVALID_COMMAND')

  const previous = await readCommandState()
  const sameCommand = previous.commandId === dispatch.command.commandId
  let carrierTabId = sameCommand ? previous.carrierTabId : undefined
  let sequence = dispatch.nextEventSequence
  await writeCommandState({
    commandId: dispatch.command.commandId,
    runId: dispatch.command.runId,
    carrierTabId,
    nextEventSequence: sequence,
    status: 'NAVIGATING',
    updatedAt: new Date().toISOString(),
  })

  const targetUrl = `${NLG_ORIGIN}/agent/sso/foresight`
  const tab = await findBoundCommandTab(carrierTabId, hint)
  if (!tab?.id) {
    const created = await chrome.tabs.create({ active: false, url: targetUrl })
    if (created.id === undefined) throw new Error('COMMAND_TAB_UNAVAILABLE')
    await writeCommandState({
      ...(await readCommandState()),
      carrierTabId: created.id,
      status: 'NAVIGATING',
      updatedAt: new Date().toISOString(),
    })
    return
  }
  carrierTabId = tab.id
  let currentUrl: URL
  try {
    currentUrl = new URL(tab.url ?? '')
  } catch {
    await updateTab(tab.id, { url: targetUrl })
    return
  }
  if (!sameCommand && currentUrl.origin === NLG_ORIGIN && currentUrl.pathname === '/NWI/Main/Layout.aspx') {
    await updateTab(tab.id, { url: targetUrl })
    return
  }
  if (currentUrl.origin === NLG_AUTH0_ORIGIN || isAuthPath(currentUrl.pathname) ||
    currentUrl.pathname.startsWith('/NWI/Unsecure/')) {
    const requirement = currentUrl.pathname.includes('/mfa') || currentUrl.pathname.includes('/challenge')
      ? 'MFA_REQUIRED' as const
      : 'AUTH_REQUIRED' as const
    if (dispatch.lastEventType !== requirement) {
      sequence = await postCommandEvent({
        dispatch, device, sequence, type: requirement,
        payload: { action: 'SIGN_IN_TO_CONTINUE' },
      })
    }
    await writeCommandState({
      ...(await readCommandState()), carrierTabId: tab.id, nextEventSequence: sequence,
      status: requirement, updatedAt: new Date().toISOString(),
    })
    if (!tab.active) await updateTab(tab.id, { active: true })
    return
  }
  if (currentUrl.origin !== NLG_ORIGIN || currentUrl.pathname !== '/NWI/Main/Layout.aspx') {
    if (currentUrl.href !== targetUrl) await updateTab(tab.id, { url: targetUrl })
    return
  }

  const rawInput = await signedJsonRequest<unknown>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/commands/${encodeURIComponent(dispatch.command.commandId)}/input`,
    body: {},
  })
  const approved = parseForesightCommandInput(rawInput)
  if (approved.inputHash !== params.inputHash || approved.snapshot.illustrationId !== params.illustrationId ||
    await sha256ForesightSnapshot(approved.snapshot) !== approved.inputHash) {
    throw new Error('FORESIGHT_INPUT_HASH_MISMATCH')
  }
  await writeCommandState({
    ...(await readCommandState()), carrierTabId: tab.id, status: 'RUNNING',
    updatedAt: new Date().toISOString(),
  })
  if (dispatch.lastEventType !== 'COMMAND_STARTED' && dispatch.lastEventType !== 'DATA_BATCH') {
    sequence = await postCommandEvent({ dispatch, device, sequence, type: 'COMMAND_STARTED' })
  }
  const token = randomToken()
  const correlationId = crypto.randomUUID()
  const response = await sendForesightExecution(tab.id, {
    type: 'EXECUTE_FORESIGHT_ILLUSTRATION',
    token,
    correlationId,
    inputHash: approved.inputHash,
    snapshot: approved.snapshot,
  })
  if (!response.ok) throw new Error(response.code)
  await uploadForesightArtifact({ dispatch, device, response })
  sequence = await postCommandEvent({
    dispatch,
    device,
    sequence,
    type: 'DATA_BATCH',
    payload: { illustration: response.receipt },
  })
  sequence = await postCommandEvent({
    dispatch,
    device,
    sequence,
    type: 'COMMAND_COMPLETED',
    payload: { result: 'FORESIGHT_NAIC_ILLUSTRATION_READY', receipt: response.receipt },
  })
  await writeCommandState({
    commandId: dispatch.command.commandId,
    runId: dispatch.command.runId,
    carrierTabId: tab.id,
    nextEventSequence: sequence,
    status: 'COMPLETED',
    updatedAt: new Date().toISOString(),
  })
}

async function pollAndExecuteCommand(hint?: chrome.tabs.Tab, requestedCommandId?: string): Promise<void> {
  if (commandPollLock) return commandPollLock as Promise<void>
  const operation = (async () => {
    const device = await readDeviceState()
    if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) return
    await writeCommandState({ ...(await readCommandState()), status: 'POLLING' })
    try {
      const raw = await signedJsonRequest<unknown>({
        baseUrl: device.baseUrl,
        deviceId: device.deviceId,
        method: 'POST',
        pathname: '/api/agent/integrations/national-life/local-connector/commands/next',
        body: requestedCommandId ? { commandId: requestedCommandId } : {},
      })
      if (raw === undefined) {
        const current = await readCommandState()
        if (current.status === 'POLLING') await writeCommandState({ status: 'IDLE' })
        return
      }
      const dispatch = parseConnectorCommandDispatch(raw)
      const executor = dispatch.command.capability === 'GENERATE_ILLUSTRATION'
        ? executeForesightCommand
        : executePolicyDetailCommand
      await executor(dispatch, {
        deviceId: device.deviceId,
        baseUrl: device.baseUrl,
      }, hint)
    } catch (error) {
      await writeCommandState({
        ...(await readCommandState()),
        status: 'ERROR',
        errorCode: errorCode(error, 'COMMAND_FAILED'),
        updatedAt: new Date().toISOString(),
      })
    }
  })()
  const tracked: Promise<void> = operation.finally(() => {
    if (commandPollLock === tracked) commandPollLock = null
  })
  commandPollLock = tracked
  return tracked
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

async function reportRunAuthState(state: 'REQUIRED' | 'RESTORED') {
  const device = await readDeviceState()
  const sync = await readSyncState()
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !sync.runId ||
    sync.runId.length > 128
  ) {
    return
  }
  try {
    await signedJsonRequest({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'POST',
      pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(sync.runId)}/auth-state`,
      body: { state },
    })
  } catch {
    // The foreground carrier tab is the immediate hand-off. Keepr One's inbox
    // is a durable second channel and must never block login or data capture.
  }
}

async function requireCarrierAuthentication(
  state: Awaited<ReturnType<typeof readSyncState>>,
  tabId: number,
  updateProperties?: chrome.tabs.UpdateProperties,
) {
  const firstNotice = !state.authRenewalPending
  await writeSyncState({
    ...state,
    status: 'AUTH_REQUIRED',
    errorCode: undefined,
    authRenewalPending: true,
  })
  if (updateProperties) await updateTab(tabId, updateProperties)
  if (firstNotice) await reportRunAuthState('REQUIRED')
}

async function resolveCarrierAuthenticationIfNeeded() {
  const state = await readSyncState()
  if (!state.authRenewalPending) return
  await reportRunAuthState('RESTORED')
  await writeSyncState({ ...(await readSyncState()), authRenewalPending: false })
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
      if (activeDocuments.size > 0) return true
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

async function createRun(forceRefresh = false) {
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
  const response = await signedJsonRequest<{
    runId?: unknown
    stages?: unknown
    completedStages?: unknown
    nextStageIndex?: unknown
    resume?: { sequence?: unknown; offset?: unknown; recordCount?: unknown }
  }>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: '/api/agent/integrations/national-life/local-connector/runs',
    body: forceRefresh ? { forceRefresh: true } : {},
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
    response.completedStages <= plan.length
    ? response.completedStages
    : 0
  const nextStageIndex = typeof response.nextStageIndex === 'number' &&
    Number.isInteger(response.nextStageIndex) &&
    response.nextStageIndex >= 0 &&
    response.nextStageIndex <= plan.length
    ? response.nextStageIndex
    : completedStages
  const resumeSequence = typeof response.resume?.sequence === 'number' &&
    Number.isInteger(response.resume.sequence) && response.resume.sequence >= 0 && response.resume.sequence <= 10_000
    ? response.resume.sequence
    : 0
  const serverResumeOffset = typeof response.resume?.offset === 'number' &&
    Number.isInteger(response.resume.offset) && response.resume.offset >= 0 && response.resume.offset <= 200_000
    ? response.resume.offset
    : 0
  const serverResumeRecordCount = typeof response.resume?.recordCount === 'number' &&
    Number.isInteger(response.resume.recordCount) && response.resume.recordCount >= 0 && response.resume.recordCount <= 200_000
    ? response.resume.recordCount
    : 0
  // Detail pages share one server stage, so the server checkpoint is global to
  // that stage while the page extractor must restart from the beginning of the
  // current statement only. The durable base offset tells us which part belongs
  // to earlier statement links.
  const previousDetailStage = isCommissionDetailStage(currentStage(previous))
  const resumeOffset = previousDetailStage
    ? Math.max(0, serverResumeOffset - (previous.commissionDetailOffset ?? 0))
    : serverResumeOffset
  const durableDetailResume = isCommissionDetailStage(plan[nextStageIndex]) && resumeSequence > 0
  if (previous.runId === response.runId && currentStage(previous)) {
    // A retry of a still-live run must resume from the server-confirmed cursor.
    // Local storage can be stale when Chrome evicts the worker between a grid
    // acknowledgement and the following navigation.
    await writeSyncState({
      ...previous,
      runId: response.runId,
      plan,
      stageIndex: nextStageIndex,
      resumeSequence,
      resumeOffset,
      ...(previousDetailStage ? { commissionDetailReceivedRecords: serverResumeRecordCount } : {}),
      ...(durableDetailResume
        ? {
            commissionDetailLinks: undefined,
            commissionDetailIndex: undefined,
            commissionDetailOffset: undefined,
            commissionDetailCurrentOffset: undefined,
          }
        : {}),
      navigationGridKey: undefined,
      navigationAttempts: undefined,
      status: 'NAVIGATING',
      errorCode: undefined,
    })
  } else {
    await writeSyncState({
      runId: response.runId,
      plan,
      stageIndex: nextStageIndex,
      resumeSequence,
      resumeOffset,
      navigationGridKey: undefined,
      navigationAttempts: undefined,
      status: 'NAVIGATING',
      carrierTabId: previous.carrierTabId,
    })
  }
  if (nextStageIndex >= plan.length) {
    await writeSyncState({
      ...(await readSyncState()),
      stageIndex: plan.length,
      resumeSequence: undefined,
      resumeOffset: undefined,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
    })
    await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
    return
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
      const url = new URL(tab.url)
      // Chrome's native PDF viewer does not host our content-script bridge.
      // Reusing it would replace a document the agent is reading and then fail
      // the auth probe. Prefer an actual agent page or create one.
      return url.origin === NLG_ORIGIN &&
        url.pathname !== '/agent/correspondence/documentviewer'
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

async function findReusableConnectorTab(state: Awaited<ReturnType<typeof readSyncState>>) {
  const bound = await findConnectorTab(state)
  if (bound) return bound

  const tabs = await chrome.tabs.query({
    url: [`${NLG_ORIGIN}/*`, `${NLG_AUTH0_ORIGIN}/*`],
  })
  const usable = tabs.filter((tab) => typeof tab.id === 'number')
  // If an older attempt lost its stored tab id, bind to an existing carrier tab
  // instead of creating a second one. This is deliberately one-tab-first: the
  // connector must not multiply windows while recovering from a worker restart.
  return usable.find((tab) => tab.active) ?? usable[0]
}

async function navigatePendingGrid() {
  return withTabNavigationLock(async () => {
    const state = await readSyncState()
    const stage = currentStage(state)
    if (!state.runId || !stage) return
    const gridKey = stageKey(stage)
    const targetPath = stageTargetPath(state, stage)
    const target = `${NLG_ORIGIN}${targetPath}`
    const existing = await findReusableConnectorTab(state)
    const navigationAttempts = state.navigationGridKey === gridKey
      ? state.navigationAttempts ?? 0
      : 0

    if (existing?.id !== undefined) {
      if (state.carrierTabId !== existing.id) {
        await writeSyncState({ ...state, carrierTabId: existing.id })
      }
      if (existing.url) {
        try {
          const existingUrl = new URL(existing.url)
          if (existingUrl.origin === NLG_AUTH0_ORIGIN || isAuthPath(existingUrl.pathname)) {
            await requireCarrierAuthentication(
              await readSyncState(),
              existing.id,
              existing.active ? undefined : { active: true },
            )
            return
          }
          const existingPath = `${existingUrl.pathname}${existingUrl.search}`
          const isExpected = isCommissionDetailStage(stage)
            ? existingPath === targetPath
            : matchesNationalLifeStagePath(gridKey, stage.params.navigatePath, existingUrl.pathname)
          if (isExpected) {
            // There is no tabs.onUpdated event when the expected page is already
            // open, so explicitly resume the bridge without changing tabs.
            await handleTabReady(existing.id, existing.url)
            return
          }
          if (navigationAttempts >= MAX_STAGE_NAVIGATION_ATTEMPTS) {
            return skipFailedStage(existing.id, gridKey, 'PORTAL_ROUTE_CHANGED')
          }
        } catch {
          // Navigate the one bound tab when its URL is unavailable or malformed.
        }
      }
      await writeSyncState({
        ...(await readSyncState()),
        status: 'NAVIGATING',
        errorCode: undefined,
        navigationGridKey: gridKey,
        navigationAttempts: navigationAttempts + 1,
      })
      // Reuse the existing tab even when it is visible. Creating a background tab
      // here was the source of the tab storm after retries and worker recovery.
      await updateTab(existing.id, { url: target })
      return
    }

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
        navigationGridKey: gridKey,
        navigationAttempts: 1,
      })
    }
  })
}

async function startNewSync(forceRefresh = false) {
  if (documentFetchLock || activeDocuments.size > 0) {
    return { ok: false as const, error: 'DOCUMENT_FETCH_IN_PROGRESS' }
  }
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
        await createRun(forceRefresh)
        await navigatePendingGrid()
        const after = await readSyncState()
        if (after.status === 'AUTH_REQUIRED') {
          return { ok: false as const, error: 'AUTH_REQUIRED' }
        }
        return { ok: true as const, status: after.status }
      }
      await createRun(forceRefresh)
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

async function beginCommissionDetailStage(tabId: number) {
  const device = await readDeviceState()
  const state = await readSyncState()
  const stage = currentStage(state)
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !state.runId ||
    !stage ||
    !isCommissionDetailStage(stage)
  ) {
    throw new Error('SYNC_STATE_INVALID')
  }

  const response = await signedJsonRequest<unknown>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname:
      `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}` +
      '/stages/COMMISSIONS_EARNING_REPORT/details',
    body: { runId: state.runId, gridKey: 'COMMISSIONS_EARNING_REPORT' },
  })
  const links = parseCommissionDetailTargets(response)
  if (links.length === 0) throw new Error('NO_COMMISSION_DETAIL_LINKS')
  const resume = parseCommissionDetailResume(response, links)
  if ((state.resumeSequence ?? 0) > 0 && !resume) {
    // Never guess a child-page position from a global stage offset. Replaying a
    // whole statement under new sequence numbers is accepted as new raw input
    // and inflates the carrier-received count even though promotion deduplicates
    // it. A mixed-version rollout pauses safely until the server can supply the
    // durable per-statement cursor.
    await failSync('COMMISSION_DETAIL_CURSOR_UNAVAILABLE', tabId)
    return
  }
  const resumeIndex = resume
    ? links.findIndex((target) => target.statementId === resume.statementId)
    : 0

  const nextState = {
    ...state,
    commissionDetailLinks: links,
    commissionDetailIndex: resumeIndex,
    commissionDetailOffset: resume?.baseOffset ?? 0,
    commissionDetailCurrentOffset: resume?.statementOffset ?? 0,
    commissionDetailReceivedRecords: resume?.receivedRecordCount ?? 0,
    resumeSequence: resume?.sequence ?? 0,
    resumeOffset: resume?.statementOffset ?? 0,
    status: 'NAVIGATING' as const,
    navigationGridKey: stageKey(stage),
    navigationAttempts: 0,
  }
  await writeSyncState(nextState)
  await updateTab(tabId, { url: `${NLG_ORIGIN}${links[resumeIndex]!.path}` })
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
  const state = await readSyncState()
  const resumeSequence = state.resumeSequence ?? 0
  const resumeOffset = state.resumeOffset ?? 0
  const detailTarget = isCommissionDetailStage(stage) ? commissionDetailTarget(state) : undefined
  if (isCommissionDetailStage(stage) && !detailTarget) {
    throw new Error('COMMISSION_DETAIL_LINK_UNAVAILABLE')
  }
  const message = {
    type: stage.capability === 'READ_GRID' ? 'BEGIN_GRID' as const :
      stage.capability === 'READ_EXPORT' ? 'BEGIN_EXPORT' as const : 'CAPTURE_PAGE' as const,
    gridKey,
    token,
    correlationId,
    sequenceStart: resumeSequence,
    offsetStart: resumeOffset,
  }
  activeNavigations.set(tabId, {
    ...message,
    tabId,
    ...(detailTarget ? { detailStatementId: detailTarget.statementId } : {}),
  })
  await writeSyncState({
    ...(await readSyncState()),
    status: 'EXTRACTING',
    errorCode: undefined,
    navigationGridKey: undefined,
    navigationAttempts: undefined,
  })
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
        sequenceStart: resumeSequence,
        offsetStart: resumeOffset,
      })
      return
    }
    if (stage.capability === 'READ_EXPORT') {
      await sendBeginExportWithRetry(tabId, {
        type: 'BEGIN_EXPORT',
        sourceKey: 'INFORCE_CLIENTS',
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
    const remaining = records.slice(resumeOffset)
    const chunks = chunkRecordsForUpload(remaining)
    for (const [index, chunk] of chunks.entries()) {
      const sequence = resumeSequence + index
      const sourceOffset = resumeOffset + chunks
        .slice(0, index)
        .reduce((total, previous) => total + previous.length, 0)
      await uploadChunk(tabId, {
        type: 'GRID_CHUNK',
        gridKey,
        token,
        correlationId,
        sequence,
        sourceOffset,
        nextOffset: sourceOffset + chunk.length,
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

async function handleTabReadyInternal(tabId: number, urlValue?: string) {
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
    await requireCarrierAuthentication(state, tabId, { active: true })
    return
  }
  if (url.origin !== NLG_ORIGIN) return
  if (isAuthPath(url.pathname)) {
    await requireCarrierAuthentication(state, tabId)
    return
  }
  // The carrier may finish Auth0/MFA by redirecting to the authenticated agent
  // shell instead of returning directly to the grid we were waiting for. That
  // shell is proof that the login completed; resume the pending stage here so the
  // user does not have to click Sync again (and accidentally start another login
  // navigation).
  if (state.status === 'AUTH_REQUIRED' && url.pathname.startsWith('/agent/')) {
    const expectedAfterAuth = isCommissionDetailStage(stage)
      ? `${url.pathname}${url.search}` === stageTargetPath(state, stage)
      : matchesNationalLifeStagePath(stageKey(stage), stage.params.navigatePath, url.pathname)
    if (!expectedAfterAuth) {
      await navigatePendingGrid()
      return
    }
  }
  const gridKey = stageKey(stage)
  if (isCommissionDetailStage(stage)) {
    const detail = commissionDetailTarget(state)
    const basePath = canonicalNationalLifeNavigatePath(gridKey, stage.params.navigatePath)
    const actualPath = `${url.pathname}${url.search}`
    const expectedPath = detail?.path ?? basePath
    if (actualPath !== expectedPath) {
      if (state.status !== 'AUTH_REQUIRED') await navigatePendingGrid()
      return
    }
    if (!(await hasAuthenticatedPortalSession(tabId))) {
      await requireCarrierAuthentication(state, tabId, {
        active: true,
        url: `${NLG_ORIGIN}${LOGIN_PATH}`,
      })
      return
    }
    await resolveCarrierAuthenticationIfNeeded()
    if (!detail) {
      await beginCommissionDetailStage(tabId)
    } else {
      await beginExtraction(tabId, stage)
    }
    return
  }
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
    await requireCarrierAuthentication(state, tabId, {
      active: true,
      url: `${NLG_ORIGIN}${LOGIN_PATH}`,
    })
    return
  }
  await resolveCarrierAuthenticationIfNeeded()
  await beginExtraction(tabId, stage)
}

async function handleTabReady(tabId: number, urlValue?: string) {
  return withTabReadyLock(tabId, () => handleTabReadyInternal(tabId, urlValue))
}

async function uploadChunk(tabId: number, message: Extract<BridgeMessage, { type: 'GRID_CHUNK' }>) {
  const device = await readDeviceState()
  const state = await readSyncState()
  const stage = currentStage(state)
  const detailStage = isCommissionDetailStage(stage)
  const activeNavigation = activeNavigations.get(tabId)
  if (
    device.status !== 'READY' ||
    !device.deviceId ||
    !device.baseUrl ||
    !state.runId ||
    state.runId.length > 128 ||
    !stage ||
    stageKey(stage) !== message.gridKey ||
    (detailStage && !activeNavigation?.detailStatementId)
  ) {
    throw new Error('SYNC_STATE_INVALID')
  }
  const detailBaseOffset = detailStage ? state.commissionDetailOffset ?? 0 : 0
  const localSourceOffset = message.sourceOffset ?? 0
  const localNextOffset = message.nextOffset ?? (localSourceOffset + message.records.length)
  const records = detailStage
    ? message.records.map((record) => ({
        ...record,
        CommissionStatementId: activeNavigation!.detailStatementId,
      }))
    : message.records
  const sourceOffset = detailBaseOffset + localSourceOffset
  const nextOffset = detailBaseOffset + localNextOffset
  await writeSyncState({ ...state, status: 'UPLOADING', errorCode: undefined })
  const pathname = `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/stages/${encodeURIComponent(message.gridKey)}`
  let uploadResult: { duplicate?: unknown } | undefined
  try {
    uploadResult = await signedJsonRequest<{ duplicate?: unknown }>({
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
        sourceOffset,
        nextOffset,
        observedAt: new Date().toISOString(),
        recordsTotal: message.recordsTotal,
        truncated: message.truncated,
        records,
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
  const detailReceivedRecords = detailStage && uploadResult?.duplicate !== true
    ? (after.commissionDetailReceivedRecords ?? 0) + records.length
    : after.commissionDetailReceivedRecords
  await writeSyncState({
    ...after,
    uploads: (after.uploads ?? 0) + 1,
    ...(detailStage
      ? {
          commissionDetailCurrentOffset: localNextOffset,
          commissionDetailReceivedRecords: detailReceivedRecords,
        }
      : {}),
  })
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

async function finishCommissionDetailGrid(
  tabId: number,
  gridKey: string,
  state: Awaited<ReturnType<typeof readSyncState>>,
  active: ActiveNavigation,
) {
  const links = state.commissionDetailLinks
    ? parseCommissionDetailTargets({ links: state.commissionDetailLinks })
    : []
  const index = state.commissionDetailIndex ?? 0
  if (!state.plan || !state.runId || !links[index]) {
    throw new Error('COMMISSION_DETAIL_STATE_INVALID')
  }
  if (active.truncated) throw new Error('STAGE_TRUNCATED')

  const currentOffset = state.commissionDetailCurrentOffset ?? 0
  const nextIndex = index + 1
  const nextTarget = links[nextIndex]
  if (nextTarget) {
    activeNavigations.delete(tabId)
    await writeSyncState({
      ...state,
      commissionDetailIndex: nextIndex,
      commissionDetailOffset: (state.commissionDetailOffset ?? 0) + currentOffset,
      commissionDetailCurrentOffset: 0,
      resumeSequence: (active.lastSequence ?? 0) + 1,
      resumeOffset: 0,
      status: 'NAVIGATING',
      navigationGridKey: gridKey,
      navigationAttempts: 0,
    })
    await updateTab(tabId, { url: `${NLG_ORIGIN}${nextTarget.path}` })
    return
  }

  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    throw new Error('SYNC_STATE_INVALID')
  }
  const result = await signedJsonRequest<{
    nextStageIndex?: unknown
    terminal?: unknown
  }>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/stages/${encodeURIComponent(gridKey)}/complete`,
    idempotencyKey: `nlc:${state.runId}:${state.stageIndex ?? 0}:${gridKey}:complete:${active.lastSequence}`,
    body: {
      runId: state.runId,
      gridKey,
      expectedRecordCount: state.commissionDetailReceivedRecords ?? 0,
      finalSequence: active.lastSequence,
      truncated: false,
    },
  })
  activeNavigations.delete(tabId)
  const plan = parseStagePlan(state.plan)
  const fallbackNextIndex = (state.stageIndex ?? 0) + 1
  const resolvedNextIndex = typeof result.nextStageIndex === 'number' &&
    Number.isInteger(result.nextStageIndex) &&
    result.nextStageIndex >= 0 &&
    result.nextStageIndex <= plan.length
    ? result.nextStageIndex
    : fallbackNextIndex
  const next = plan[resolvedNextIndex]
  if (result.terminal === true || !next) {
    await writeSyncState({
      runId: state.runId,
      resumeSequence: undefined,
      resumeOffset: undefined,
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
    stageIndex: resolvedNextIndex,
    resumeSequence: 0,
    resumeOffset: 0,
    status: 'NAVIGATING',
    uploads: state.uploads,
  })
  const nextGridKey = stageKey(next)
  await updateTab(tabId, {
    url: `${NLG_ORIGIN}${canonicalNationalLifeNavigatePath(nextGridKey, next.params.navigatePath)}`,
  })
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
  if (isCommissionDetailStage(stage)) {
    await finishCommissionDetailGrid(tabId, gridKey, state, active)
    return
  }
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    throw new Error('SYNC_STATE_INVALID')
  }
  const result = await signedJsonRequest<{
    nextStageIndex?: unknown
    terminal?: unknown
  }>({
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
  const fallbackNextIndex = (state.stageIndex ?? 0) + 1
  const nextIndex = typeof result.nextStageIndex === 'number' &&
    Number.isInteger(result.nextStageIndex) &&
    result.nextStageIndex >= 0 &&
    result.nextStageIndex <= plan.length
    ? result.nextStageIndex
    : fallbackNextIndex
  const next = plan[nextIndex]
  if (result.terminal === true || !next) {
    await writeSyncState({
      runId: state.runId,
      resumeSequence: undefined,
      resumeOffset: undefined,
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
    resumeSequence: 0,
    resumeOffset: 0,
    status: 'NAVIGATING',
    uploads: state.uploads,
  })
  const nextGridKey = stageKey(next)
  const nextPath = canonicalNationalLifeNavigatePath(nextGridKey, next.params.navigatePath)
  await updateTab(tabId, { url: `${NLG_ORIGIN}${nextPath}` })
}

async function advanceAfterExport(tabId: number, result: { nextStageIndex?: unknown; terminal?: unknown }) {
  const state = await readSyncState()
  if (!state.runId || !state.plan) throw new Error('SYNC_STATE_INVALID')
  const plan = parseStagePlan(state.plan)
  const fallbackNextIndex = (state.stageIndex ?? 0) + 1
  const nextIndex = typeof result.nextStageIndex === 'number' && Number.isInteger(result.nextStageIndex) &&
    result.nextStageIndex >= 0 && result.nextStageIndex <= plan.length
    ? result.nextStageIndex : fallbackNextIndex
  const next = plan[nextIndex]
  activeNavigations.delete(tabId)
  if (result.terminal === true || !next) {
    await writeSyncState({ runId: state.runId, stageIndex: plan.length, status: 'COMPLETED', uploads: state.uploads, completedAt: new Date().toISOString() })
    await chrome.alarms.clear(SYNC_WATCHDOG_ALARM)
    return
  }
  await writeSyncState({ runId: state.runId, plan, stageIndex: nextIndex, resumeSequence: 0, resumeOffset: 0, status: 'NAVIGATING', uploads: state.uploads })
  const nextGridKey = stageKey(next)
  await updateTab(tabId, { url: `${NLG_ORIGIN}${canonicalNationalLifeNavigatePath(nextGridKey, next.params.navigatePath)}` })
}

async function processExportMessage(tabId: number, message: Extract<BridgeMessage, { type: 'EXPORT_BEGIN' | 'EXPORT_CHUNK' | 'EXPORT_DONE' }>) {
  const device = await readDeviceState()
  const state = await readSyncState()
  const active = activeNavigations.get(tabId)
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl || !state.runId || !active) {
    throw new Error('SYNC_STATE_INVALID')
  }
  await writeSyncState({ ...state, status: 'UPLOADING', errorCode: undefined })
  if (message.type === 'EXPORT_BEGIN') {
    const result = await signedJsonRequest<{ uploadId?: unknown; nextSequence?: unknown; completed?: unknown }>({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'POST',
      pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/exports/INFORCE_CLIENTS`,
      body: {
        runId: state.runId,
        sourceKey: 'INFORCE_CLIENTS',
        fileName: message.fileName,
        contentType: message.contentType,
        expectedBytes: message.expectedBytes,
        expectedSha256: message.expectedSha256,
      },
    })
    if (typeof result.uploadId !== 'string' || !Number.isInteger(result.nextSequence)) throw new Error('INVALID_EXPORT_RESPONSE')
    activeNavigations.set(tabId, { ...active, exportUploadId: result.uploadId, exportNextSequence: result.nextSequence as number })
    return
  }
  if (!active.exportUploadId) throw new Error('EXPORT_UPLOAD_NOT_STARTED')
  if (message.type === 'EXPORT_CHUNK') {
    if (message.sequence < (active.exportNextSequence ?? 0)) return
    if (message.sequence !== (active.exportNextSequence ?? 0)) throw new Error('EXPORT_CHUNK_INVALID')
    await signedBinaryRequest({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'PUT',
      pathname: `/api/agent/integrations/national-life/local-connector/exports/${encodeURIComponent(active.exportUploadId)}/chunks/${message.sequence}`,
      body: Uint8Array.from(message.bytes),
    })
    const latest = activeNavigations.get(tabId)
    if (latest) activeNavigations.set(tabId, { ...latest, exportNextSequence: message.sequence + 1 })
    const after = await readSyncState()
    await writeSyncState({ ...after, uploads: (after.uploads ?? 0) + 1 })
    return
  }
  const result = await signedJsonRequest<{ nextStageIndex?: unknown; terminal?: unknown }>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/exports/${encodeURIComponent(active.exportUploadId)}/complete`,
    body: { uploadId: active.exportUploadId },
  })
  await advanceAfterExport(tabId, result)
}

function settleDocument(tabId: number, result: DocumentFetchResult) {
  const active = activeDocuments.get(tabId)
  if (!active) return
  clearTimeout(active.timer)
  activeDocuments.delete(tabId)
  active.resolve(result)
}

async function processDocumentMessage(
  tabId: number,
  message: Extract<BridgeMessage, { type: 'DOCUMENT_BEGIN' | 'DOCUMENT_CHUNK' | 'DOCUMENT_DONE' | 'DOCUMENT_ERROR' }>,
) {
  const active = activeDocuments.get(tabId)
  if (!active || active.transferId !== message.transferId ||
    active.token !== message.token || active.correlationId !== message.correlationId) return
  const device = await readDeviceState()
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    settleDocument(tabId, { ok: false, error: 'CONNECTOR_NOT_PAIRED' })
    return
  }
  try {
    if (message.type === 'DOCUMENT_ERROR') {
      settleDocument(tabId, { ok: false, error: message.code })
      return
    }
    if (message.type === 'DOCUMENT_BEGIN') {
      const result = await signedJsonRequest<{ nextSequence?: unknown; completed?: unknown }>({
        baseUrl: device.baseUrl,
        deviceId: device.deviceId,
        method: 'POST',
        pathname: `/api/agent/integrations/national-life/local-connector/document-transfers/${encodeURIComponent(active.transferId)}/begin`,
        body: {
          transferId: active.transferId,
          contentType: message.contentType,
          expectedBytes: message.expectedBytes,
          expectedSha256: message.expectedSha256,
        },
      })
      if (!Number.isInteger(result.nextSequence)) throw new Error('INVALID_DOCUMENT_RESPONSE')
      const current = activeDocuments.get(tabId)
      if (current) activeDocuments.set(tabId, { ...current, nextSequence: result.nextSequence as number })
      return
    }
    const current = activeDocuments.get(tabId)
    if (!current) return
    if (message.type === 'DOCUMENT_CHUNK') {
      if (message.sequence < current.nextSequence) return
      if (message.sequence !== current.nextSequence) throw new Error('DOCUMENT_CHUNK_INVALID')
      await signedBinaryRequest({
        baseUrl: device.baseUrl,
        deviceId: device.deviceId,
        method: 'PUT',
        pathname: `/api/agent/integrations/national-life/local-connector/document-transfers/${encodeURIComponent(current.transferId)}/chunks/${message.sequence}`,
        body: Uint8Array.from(message.bytes),
      })
      const latest = activeDocuments.get(tabId)
      if (latest) activeDocuments.set(tabId, { ...latest, nextSequence: message.sequence + 1 })
      return
    }
    const result = await signedJsonRequest<{ documentId?: unknown }>({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'POST',
      pathname: `/api/agent/integrations/national-life/local-connector/document-transfers/${encodeURIComponent(current.transferId)}/complete`,
      body: { transferId: current.transferId },
    })
    if (typeof result.documentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.documentId)) {
      throw new Error('INVALID_DOCUMENT_RESPONSE')
    }
    settleDocument(tabId, { ok: true, documentId: result.documentId })
  } catch (error) {
    settleDocument(tabId, { ok: false, error: errorCode(error, 'DOCUMENT_FETCH_FAILED') })
  }
}

async function waitForLoadedAgentTab(tabId: number): Promise<chrome.tabs.Tab> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete' && tab.url) return tab
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('NATIONAL_LIFE_TAB_TIMEOUT')
}

async function fetchNationalLifeDocumentInternal(
  message: Extract<ReturnType<typeof parseExternalMessage>, { type: 'FETCH_NATIONAL_LIFE_DOCUMENT' }>,
): Promise<DocumentFetchResult> {
  const [device, sync] = await Promise.all([readDeviceState(), readSyncState()])
  if (device.status !== 'READY' || !device.deviceId || !device.baseUrl) {
    return { ok: false, error: 'CONNECTOR_NOT_PAIRED' }
  }
  if (syncStartLock || isBusySyncStatus(sync.status) || activeNavigations.size > 0) {
    return { ok: false, error: 'SYNC_IN_PROGRESS' }
  }
  if (activeDocuments.size > 0) return { ok: false, error: 'DOCUMENT_FETCH_IN_PROGRESS' }
  const remote = await ensureFreshRemoteConfig(device.baseUrl)
  if (!remote.syncEnabled || remote.disabledCapabilities.includes('READ_DOCUMENT')) {
    return { ok: false, error: 'CONNECTOR_PAUSED' }
  }
  if (!remote.executableCapabilities.includes('READ_DOCUMENT')) {
    return { ok: false, error: 'CLIENT_TOO_OLD' }
  }

  try {
    const requested = await signedJsonRequest<{
      completed?: unknown
      documentId?: unknown
      transferId?: unknown
      encryptedHandle?: unknown
    }>({
      baseUrl: device.baseUrl,
      deviceId: device.deviceId,
      method: 'POST',
      pathname: `/api/agent/integrations/national-life/local-connector/documents/${encodeURIComponent(message.reportRowId)}`,
      body: { reportRowId: message.reportRowId },
    })
    if (requested.completed === true && typeof requested.documentId === 'string') {
      return { ok: true, documentId: requested.documentId }
    }
    if (
      typeof requested.transferId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(requested.transferId) ||
      typeof requested.encryptedHandle !== 'string'
    ) return { ok: false, error: 'INVALID_DOCUMENT_RESPONSE' }

    let tab = await findNationalLifeTab()
    if (tab?.id === undefined) {
      tab = await chrome.tabs.create({ url: `${NLG_ORIGIN}/agent/`, active: false })
    }
    if (tab.id === undefined) return { ok: false, error: 'NATIONAL_LIFE_TAB_UNAVAILABLE' }
    const tabId = tab.id
    tab = await waitForLoadedAgentTab(tabId)
    if (!tab.url || new URL(tab.url).origin !== NLG_ORIGIN || !(await hasAuthenticatedPortalSession(tabId))) {
      await updateTab(tabId, { active: true, url: `${NLG_ORIGIN}${LOGIN_PATH}` })
      return { ok: false, error: 'AUTH_REQUIRED' }
    }

    const token = randomToken()
    const correlationId = crypto.randomUUID()
    const result = new Promise<DocumentFetchResult>((resolve) => {
      const timer = setTimeout(() => settleDocument(tabId, { ok: false, error: 'DOCUMENT_FETCH_TIMEOUT' }), 3 * 60_000)
      activeDocuments.set(tabId, {
        transferId: requested.transferId as string,
        token,
        correlationId,
        tabId,
        nextSequence: 0,
        resolve,
        timer,
      })
    })
    try {
      await sendBeginDocumentWithRetry(tabId, {
        type: 'BEGIN_DOCUMENT',
        transferId: requested.transferId,
        encryptedHandle: requested.encryptedHandle,
        token,
        correlationId,
      })
    } catch (error) {
      settleDocument(tabId, { ok: false, error: errorCode(error, 'BRIDGE_UNAVAILABLE') })
    }
    return await result
  } catch (error) {
    return { ok: false, error: errorCode(error, 'DOCUMENT_FETCH_FAILED') }
  }
}

async function fetchNationalLifeDocument(
  message: Extract<ReturnType<typeof parseExternalMessage>, { type: 'FETCH_NATIONAL_LIFE_DOCUMENT' }>,
): Promise<DocumentFetchResult> {
  // External messages can arrive concurrently. Reserve the operation before
  // the first await so two clicks cannot both see an empty activeDocuments map
  // and overwrite each other's correlation state on the same carrier tab.
  if (documentFetchLock) return { ok: false, error: 'DOCUMENT_FETCH_IN_PROGRESS' }
  documentFetchLock = true
  try {
    return await fetchNationalLifeDocumentInternal(message)
  } finally {
    documentFetchLock = false
  }
}

async function skipFailedStage(tabId: number, gridKey: string, code: string) {
  const state = await readSyncState()
  const stage = currentStage(state)
  const device = await readDeviceState()
  if (
    !state.runId || !state.plan || !stage || stageKey(stage) !== gridKey ||
    device.status !== 'READY' || !device.deviceId || !device.baseUrl
  ) {
    throw new Error('SYNC_STATE_INVALID')
  }
  const result = await signedJsonRequest<{
    nextStageIndex?: unknown
    terminal?: unknown
  }>({
    baseUrl: device.baseUrl,
    deviceId: device.deviceId,
    method: 'POST',
    pathname: `/api/agent/integrations/national-life/local-connector/runs/${encodeURIComponent(state.runId)}/stages/${encodeURIComponent(gridKey)}/fail`,
    idempotencyKey: `nlc:${state.runId}:${state.stageIndex ?? 0}:${gridKey}:fail:${code}`,
    body: { runId: state.runId, gridKey, code, retryable: true },
  })
  const plan = parseStagePlan(state.plan)
  const fallbackNextIndex = (state.stageIndex ?? 0) + 1
  const nextIndex = typeof result.nextStageIndex === 'number' &&
    Number.isInteger(result.nextStageIndex) &&
    result.nextStageIndex >= 0 &&
    result.nextStageIndex <= plan.length
    ? result.nextStageIndex
    : fallbackNextIndex
  const next = plan[nextIndex]
  if (result.terminal === true || !next) {
    await writeSyncState({
      runId: state.runId,
      stageIndex: plan.length,
      status: 'PARTIAL',
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
    resumeSequence: 0,
    resumeOffset: 0,
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

async function recoverCommissionDetailIdempotencyRace(tabId: number): Promise<boolean> {
  const state = await readSyncState()
  if (!isCommissionDetailStage(currentStage(state)) || (state.commissionDetailRecoveryAttempts ?? 0) >= 1) {
    return false
  }
  await writeSyncState({
    ...state,
    status: 'STARTING',
    errorCode: undefined,
    commissionDetailRecoveryAttempts: (state.commissionDetailRecoveryAttempts ?? 0) + 1,
  })
  try {
    // The run is still RUNNING: the 409 rejected the stale chunk before any
    // mutation. Re-entering the signed start endpoint returns its durable
    // sequence; the details endpoint then resolves that global cursor to the
    // exact statement and local offset.
    await createRun()
    await navigatePendingGrid()
  } catch (error) {
    await failSync(errorCode(error, 'SYNC_RESUME_FAILED'), tabId)
  }
  return true
}

async function processBridgeMessage(tabId: number, message: BridgeMessage) {
  if ('transferId' in message) {
    await processDocumentMessage(tabId, message)
    return
  }
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
    if (message.type === 'EXPORT_BEGIN' || message.type === 'EXPORT_CHUNK' || message.type === 'EXPORT_DONE') {
      await processExportMessage(tabId, message)
    } else if (message.type === 'GRID_CHUNK') await uploadChunk(tabId, message)
    else if (message.type === 'GRID_DONE') await finishGrid(tabId, message.gridKey)
    else {
      activeNavigations.delete(tabId)
      await skipFailedStage(tabId, message.gridKey, message.code)
    }
  } catch (error) {
    // A ordem de parar vem antes de tudo: antes do `delete`, que apaga o token
    // de que ela precisa, e antes de `failSync`, que num CLIENT_TOO_OLD pode
    // chamar `chrome.runtime.reload()` e matar este worker no meio. Um GRID_ERROR
    // não passa por aqui — ali o extrator já parou sozinho.
    await abortExtraction(tabId)
    activeNavigations.delete(tabId)
    const code = error instanceof Error ? error.message : 'UPLOAD_FAILED'
    if (code === 'IDEMPOTENCY_CONFLICT' && await recoverCommissionDetailIdempotencyRace(tabId)) {
      return
    }
    await failSync(code, tabId)
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
  const [device, sync, command] = await Promise.all([
    readDeviceState(), readSyncState(), readCommandState(),
  ])
  const stage = currentStage(sync)
  return {
    ok: true as const,
    device,
    sync: {
      ...sync,
      stageKey: stage ? stageKey(stage) : undefined,
      totalStages: sync.plan?.length,
    },
    command,
  }
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
    if (message.type === 'FETCH_NATIONAL_LIFE_DOCUMENT') {
      respond(sendResponse, fetchNationalLifeDocument(message))
      return true
    }
    if (message.type === 'START_NATIONAL_LIFE_COMMAND') {
      respond(
        sendResponse,
        pollAndExecuteCommand(undefined, message.commandId).then(async () => {
          const command = await readCommandState()
          return command.commandId === message.commandId && command.status !== 'ERROR'
            ? { ok: true as const, commandId: message.commandId, command }
            : { ok: false as const, commandId: message.commandId, error: command.errorCode ?? 'COMMAND_UNAVAILABLE', command }
        }),
      )
      return true
    }
    respond(sendResponse, startNewSync(message.forceRefresh === true))
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
          const command = await readCommandState()
          if (
            (command.status === 'AUTH_REQUIRED' || command.status === 'MFA_REQUIRED') &&
            command.carrierTabId !== undefined
          ) {
            const commandTab = await findBoundCommandTab(command.carrierTabId)
            if (commandTab?.id !== undefined) {
              await updateTab(commandTab.id, { active: true })
              return { ok: true as const }
            }
          }
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
      void (async () => {
        const command = await readCommandState()
        if (command.carrierTabId === tabId && command.status !== 'COMPLETED') {
          await pollAndExecuteCommand(tab)
        }
      })()
      void handleTabReady(tabId, tab.url).catch((error) =>
        failSync(errorCode(error, 'TAB_EDIT_FAILED')),
      )
    }
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    settleDocument(tabId, { ok: false, error: 'CONNECTOR_TAB_CLOSED' })
    activeNavigations.delete(tabId)
    tabQueues.delete(tabId)
    tabReadyLocks.delete(tabId)
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
    if (alarm.name === SYNC_WATCHDOG_ALARM) {
      void resumePending({ reconcileWithServer: true }).catch((error) => failSync(errorCode(error, 'SYNC_RESUME_FAILED')))
      return
    }
    if (alarm.name === SCHEDULED_SYNC_ALARM) {
      void startScheduledSyncIfDue().catch((error) => failSync(errorCode(error, 'SYNC_START_FAILED')))
      return
    }
    if (alarm.name === COMMAND_POLL_ALARM) {
      void pollAndExecuteCommand()
    }
  })

  void (async () => {
    const state = await readSyncState()
    // If Chrome evicted us after the server accepted GRID_DONE, storage still
    // says UPLOADING even though the server has already advanced the durable
    // cursor. Reconcile immediately on this recovery path; waiting for a user
    // click or the next alarm would turn a recoverable hand-off into a stall.
    await resumePending({ reconcileWithServer: state.status === 'UPLOADING' })
  })().catch((error) => failSync(errorCode(error, 'SYNC_RESUME_FAILED')))
  // The integration page is an observer, not an executor. A durable Chrome
  // alarm wakes the extension and starts a due daily run even when Keepr One is
  // closed. Chrome and the carrier session still have to be available; if the
  // session needs attention, the existing AUTH_REQUIRED path brings its one
  // bound National Life tab to the foreground.
  void ensureScheduledSyncAlarm().catch(() => {})
  void ensureCommandPollAlarm().catch(() => {})
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
