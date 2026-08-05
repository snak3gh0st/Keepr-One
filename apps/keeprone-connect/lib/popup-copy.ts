import { connectorFailure } from './failure'
import type { DeviceState, SyncState } from './state'

const STATUS_TEXT: Record<Exclude<SyncState['status'], 'ERROR'>, string> = {
  IDLE: 'Ready to sync. Start it from the National Life page in Keepr One.',
  STARTING: 'Getting your sync ready…',
  NAVIGATING: 'Opening the right National Life page…',
  EXTRACTING: 'Reading what National Life is showing…',
  UPLOADING: 'Sending your data securely to Keepr One…',
  AUTH_REQUIRED: 'Sign in to National Life. Your sync picks up from there on its own.',
  COMPLETED: 'Your data is up to date.',
}

export function popupStatusText(device: DeviceState, sync: SyncState): string {
  if (device.status === 'PAIRING') return 'Linking this computer to Keepr One…'
  if (device.status !== 'READY') {
    // Um pareamento morto deixa a falha gravada no sync; é ela que explica por
    // que o dispositivo saiu do ar, em vez do genérico "conecte pela página".
    if (sync.status === 'ERROR') return connectorFailure(sync.errorCode).message
    return 'Connect this computer from the National Life page in Keepr One.'
  }
  if (sync.status === 'ERROR') return connectorFailure(sync.errorCode).message
  return STATUS_TEXT[sync.status]
}

/// Só oferecemos "try again" quando repetir pode dar certo. Numa falha que pede
/// reconectar ou atualizar a extensão, o botão seria um beco sem saída.
export function popupCanRetry(device: DeviceState, sync: SyncState): boolean {
  if (device.status !== 'READY') return false
  if (sync.status === 'AUTH_REQUIRED') return true
  if (sync.status !== 'ERROR') return false
  const action = connectorFailure(sync.errorCode).action
  return action === 'retry' || action === 'support'
}
