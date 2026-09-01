import { parseStagePlan, type StagePlan } from './capabilities'
import { parseForesightProgressPhase, type ForesightProgressPhase } from './foresight-progress'

export type ConnectorStatus = 'UNPAIRED' | 'PAIRING' | 'READY' | 'ERROR'
export type SyncStatus =
  | 'IDLE'
  | 'STARTING'
  | 'NAVIGATING'
  | 'EXTRACTING'
  | 'UPLOADING'
  | 'AUTH_REQUIRED'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'ERROR'

export type DeviceState = {
  deviceId?: string
  baseUrl?: string
  credentialEncryptionKeyRegistered?: boolean
  status: ConnectorStatus
}

export type SyncState = {
  runId?: string
  /// Id da aba criada e mantida pelo conector. Nunca é inferido de uma aba do
  /// usuário: sem este vínculo, um retry pode sequestrar o portal que o agente
  /// está usando.
  carrierTabId?: number
  /// The plan the server handed us for this run, plus where in it we are. The
  /// extension no longer knows which grids exist, so "what comes next" is data,
  /// not code. A stored state written by an older version has no plan; every
  /// caller treats that as "no run in progress" and starts a fresh one, which the
  /// server answers with `duplicate: true` and the plan already persisted on the
  /// open run.
  plan?: StagePlan[]
  stageIndex?: number
  /// Checkpoint durável devolvido pelo servidor para a fase atual.
  resumeSequence?: number
  resumeOffset?: number
  /// Counts consecutive attempts to reach the current carrier route. It is
  /// persisted because Chrome can evict the worker between redirects.
  navigationGridKey?: string
  navigationAttempts?: number
  /// A commission-detail stage is one server stage backed by several carrier
  /// pages. These fields are the durable cursor for that child-page loop.
  commissionDetailLinks?: Array<{ path: string; statementId: string }>
  commissionDetailIndex?: number
  commissionDetailOffset?: number
  commissionDetailCurrentOffset?: number
  commissionDetailReceivedRecords?: number
  /// One automatic recovery is allowed when a stale child-page attempt races
  /// the server's durable sequence cursor. Persisted to prevent retry loops
  /// across service-worker eviction.
  commissionDetailRecoveryAttempts?: number
  /// A duplicated page reader can race the server cursor after Chrome restores
  /// a tab or service worker. Reconcile one time per ordinary grid rather than
  /// discarding the whole run and all remaining stages.
  idempotencyRecoveryGridKey?: string
  idempotencyRecoveryAttempts?: number
  /// True only while the carrier asks the agent to renew the browser session.
  /// No credential, cookie or MFA material is ever stored here.
  authRenewalPending?: boolean
  status: SyncStatus
  errorCode?: string
  /// Contador monotônico de lotes enviados neste run. Existe porque `status` e
  /// `stageIndex` ficam parados durante o upload de uma grade grande: sem ele a
  /// página não distingue "travou" de "ainda subindo", e um sync legítimo e
  /// demorado vira falha inventada.
  uploads?: number
  /// Quando o último run terminou de verdade. Um `COMPLETED` sem data é grudento
  /// e mente: a página passaria a vida dizendo "concluído".
  completedAt?: string
}

export type CommandStatus =
  | 'IDLE'
  | 'POLLING'
  | 'NAVIGATING'
  | 'RUNNING'
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'COMPLETED'
  | 'ERROR'

export type CommandProgressPhase = ForesightProgressPhase |
  'OPENING_IGO' |
  'WAITING_IGO_HANDOFF' |
  'WRITING_IGO_DRAFT'

/// Independent from the daily sync cursor. Only safe coordination metadata is
/// durable here; command payloads, carrier cookies and credentials never are.
export type CommandState = {
  commandId?: string
  runId?: string
  carrierTabId?: number
  nextEventSequence?: number
  status: CommandStatus
  errorCode?: string
  updatedAt?: string
  /// Fine-grained, non-sensitive progress for the active official illustration.
  /// It is presentation state only; command events remain the audit authority.
  phase?: CommandProgressPhase
}

const COMMAND_STATUSES = [
  'IDLE', 'POLLING', 'NAVIGATING', 'RUNNING', 'AUTH_REQUIRED',
  'MFA_REQUIRED', 'COMPLETED', 'ERROR',
] as const satisfies readonly CommandStatus[]

const IGO_COMMAND_PHASES = [
  'OPENING_IGO', 'WAITING_IGO_HANDOFF', 'WRITING_IGO_DRAFT',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max = 240): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
}

function parseCommandProgressPhase(value: unknown): CommandProgressPhase | undefined {
  return parseForesightProgressPhase(value) ??
    (typeof value === 'string' && (IGO_COMMAND_PHASES as readonly string[]).includes(value)
      ? value as CommandProgressPhase
      : undefined)
}

/// chrome.storage survives extension upgrades. Treat it as an untrusted
/// compatibility boundary so a stale or half-written command cannot bind the
/// new engine to the wrong tab or leave the popup in an impossible state.
export function parseCommandState(value: unknown): CommandState {
  if (!isRecord(value) || typeof value.status !== 'string' ||
    !(COMMAND_STATUSES as readonly string[]).includes(value.status)) {
    return { status: 'IDLE' }
  }

  const state: CommandState = { status: value.status as CommandStatus }
  if (boundedString(value.commandId)) state.commandId = value.commandId
  if (boundedString(value.runId)) state.runId = value.runId
  if (Number.isInteger(value.carrierTabId) && Number(value.carrierTabId) > 0) {
    state.carrierTabId = Number(value.carrierTabId)
  }
  if (Number.isInteger(value.nextEventSequence) && Number(value.nextEventSequence) >= 0) {
    state.nextEventSequence = Number(value.nextEventSequence)
  }
  if (typeof value.errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.errorCode)) {
    state.errorCode = value.errorCode
  }
  if (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))) {
    state.updatedAt = value.updatedAt
  }
  const phase = parseCommandProgressPhase(value.phase)
  if (phase) state.phase = phase
  return state
}

/// The plan round-trips through chrome.storage.local, which survives extension
/// updates. Re-validating on read means a stale or half-written shape degrades into
/// "no plan" instead of steering navigation with something we never checked.
export function currentStage(state: SyncState): StagePlan | undefined {
  if (!state.plan || typeof state.stageIndex !== 'number') return undefined
  try {
    return parseStagePlan(state.plan)[state.stageIndex]
  } catch {
    return undefined
  }
}

const DEVICE_KEY = 'device'
const SYNC_KEY = 'sync'
const COMMAND_KEY = 'command'

export async function readDeviceState(): Promise<DeviceState> {
  const result = await chrome.storage.local.get(DEVICE_KEY)
  const value = result[DEVICE_KEY] as DeviceState | undefined
  return value ?? { status: 'UNPAIRED' }
}

export async function writeDeviceState(value: DeviceState): Promise<void> {
  await chrome.storage.local.set({ [DEVICE_KEY]: value })
}

export async function readSyncState(): Promise<SyncState> {
  const result = await chrome.storage.local.get(SYNC_KEY)
  const value = result[SYNC_KEY] as SyncState | undefined
  return value ?? { status: 'IDLE' }
}

export async function writeSyncState(value: SyncState): Promise<void> {
  await chrome.storage.local.set({ [SYNC_KEY]: value })
}

export async function readCommandState(): Promise<CommandState> {
  const result = await chrome.storage.local.get(COMMAND_KEY)
  return parseCommandState(result[COMMAND_KEY])
}

export async function writeCommandState(value: CommandState): Promise<void> {
  await chrome.storage.local.set({ [COMMAND_KEY]: value })
}
