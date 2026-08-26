import { connectorFailure } from './failure'
import type { CommandState, DeviceState, SyncState } from './state'

const STATUS_TEXT: Record<Exclude<SyncState['status'], 'ERROR'>, string> = {
  IDLE: 'Ready to sync. Start it from the National Life page in Keepr One.',
  STARTING: 'Getting your sync ready…',
  NAVIGATING: 'Opening the right National Life page…',
  EXTRACTING: 'Reading what National Life is showing…',
  UPLOADING: 'Sending your data securely to Keepr One…',
  AUTH_REQUIRED: 'Sign in to National Life. Your sync picks up from there on its own.',
  COMPLETED: 'Your data is up to date.',
  PARTIAL: 'Available areas were saved. Retry from Keepr One to finish the remaining areas.',
}

const COMMAND_STATUS_TEXT: Partial<Record<CommandState['status'], string>> = {
  POLLING: 'Checking for a Keepr One request…',
  NAVIGATING: 'Opening the requested National Life page in the background…',
  RUNNING: 'Reading the requested National Life data…',
  AUTH_REQUIRED: 'Sign in to National Life. Your request will resume automatically.',
  MFA_REQUIRED: 'Complete National Life verification. Your request will resume automatically.',
  COMPLETED: 'Your latest National Life request is complete.',
}

export function popupStatusText(
  device: DeviceState,
  sync: SyncState,
  command?: CommandState,
): string {
  if (device.status === 'PAIRING') return 'Linking this computer to Keepr One…'
  if (device.status !== 'READY') {
    // Um pareamento morto deixa a falha gravada no sync; é ela que explica por
    // que o dispositivo saiu do ar, em vez do genérico "conecte pela página".
    if (sync.status === 'ERROR') return connectorFailure(sync.errorCode).message
    return 'Connect this computer from the National Life page in Keepr One.'
  }
  if (command?.status === 'ERROR') return connectorFailure(command.errorCode).message
  const commandText = command ? COMMAND_STATUS_TEXT[command.status] : undefined
  if (commandText && command?.status !== 'COMPLETED') return commandText
  if (sync.status === 'ERROR') return connectorFailure(sync.errorCode).message
  if (commandText) return commandText
  return STATUS_TEXT[sync.status]
}

/// Só oferecemos "try again" quando repetir pode dar certo. Numa falha que pede
/// reconectar ou atualizar a extensão, o botão seria um beco sem saída.
export function popupCanRetry(device: DeviceState, sync: SyncState): boolean {
  if (device.status !== 'READY') return false
  if (sync.status === 'AUTH_REQUIRED') return true
  if (sync.status === 'PARTIAL') return true
  if (sync.status !== 'ERROR') return false
  const action = connectorFailure(sync.errorCode).action
  return action === 'retry' || action === 'support'
}
