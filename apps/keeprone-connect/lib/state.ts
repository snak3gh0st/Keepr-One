import type { GridKey } from './constants'

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
  nextGrid?: GridKey
  status: SyncStatus
  errorCode?: string
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
