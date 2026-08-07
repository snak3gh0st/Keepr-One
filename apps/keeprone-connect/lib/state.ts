import { parseStagePlan, type StagePlan } from './capabilities'

export type ConnectorStatus = 'UNPAIRED' | 'PAIRING' | 'READY' | 'ERROR'
export type SyncStatus =
  | 'IDLE'
  | 'STARTING'
  | 'NAVIGATING'
  | 'EXTRACTING'
  | 'UPLOADING'
  | 'AUTH_REQUIRED'
  | 'COMPLETED'
  | 'ERROR'

export type DeviceState = {
  deviceId?: string
  baseUrl?: string
  status: ConnectorStatus
}

export type SyncState = {
  runId?: string
  /// The plan the server handed us for this run, plus where in it we are. The
  /// extension no longer knows which grids exist, so "what comes next" is data,
  /// not code. A stored state written by an older version has no plan; every
  /// caller treats that as "no run in progress" and starts a fresh one, which the
  /// server answers with `duplicate: true` and the plan already persisted on the
  /// open run.
  plan?: StagePlan[]
  stageIndex?: number
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
