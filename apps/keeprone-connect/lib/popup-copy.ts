import { connectorFailure } from './failure'
import type { CommandState, DeviceState, SyncState } from './state'

const STATUS_TEXT: Record<Exclude<SyncState['status'], 'ERROR'>, string> = {
  IDLE: 'K-Bot is ready. Start a National Life task from Keepr One.',
  STARTING: 'K-Bot is preparing the approved sync…',
  NAVIGATING: 'K-Bot is opening the next National Life area…',
  EXTRACTING: 'K-Bot is reading the information shown by National Life…',
  UPLOADING: 'K-Bot is organizing this information in Keepr One…',
  AUTH_REQUIRED: 'Sign in to National Life. K-Bot will continue the same sync automatically.',
  COMPLETED: 'K-Bot finished. Your verified data is up to date.',
  PARTIAL: 'K-Bot saved the available areas. Resume from Keepr One to finish the rest.',
}

const COMMAND_STATUS_TEXT: Partial<Record<CommandState['status'], string>> = {
  POLLING: 'K-Bot is checking the next approved Keepr One task…',
  NAVIGATING: 'K-Bot is opening the requested National Life tool in the background…',
  RUNNING: 'K-Bot is completing the requested work in National Life…',
  AUTH_REQUIRED: 'Sign in to National Life. K-Bot will continue the same task automatically.',
  MFA_REQUIRED: 'Complete National Life verification. K-Bot will continue automatically.',
  COMPLETED: 'K-Bot completed the latest National Life task.',
}

const FORESIGHT_PHASE_TEXT: Record<string, string> = {
  OPENING_IGO: 'K-Bot is opening iGO…',
  WAITING_IGO_HANDOFF: 'K-Bot selected iGO e-App and is waiting for the secure handoff…',
  WRITING_IGO_DRAFT: 'K-Bot is creating the iGO draft and checking its read-back…',
  OPENING_FORESIGHT: 'K-Bot is opening Foresight…',
  OPENING_CASE: 'K-Bot is opening the illustration case…',
  FILLING_CLIENT: 'K-Bot is entering the insured details…',
  CONFIGURING_PRODUCT: 'K-Bot is entering the product and requested values…',
  CALCULATING: 'K-Bot is waiting for National Life to calculate…',
  VERIFYING_VALUES: 'K-Bot is checking the values returned by National Life…',
  SAVING_CASE: 'K-Bot is saving the case in National Life…',
  GENERATING_PDF: 'K-Bot is creating the official PDF…',
  UPLOADING_PDF: 'K-Bot is bringing the PDF into Keepr One…',
  COMPLETED: 'K-Bot completed the official illustration.',
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

export function popupSyncStatusText(device: DeviceState, sync: SyncState): string {
  return popupStatusText(device, sync)
}

export function popupCommandStatusText(command: CommandState): string {
  if (command.status === 'ERROR') return connectorFailure(command.errorCode).message
  if (command.status === 'AUTH_REQUIRED' || command.status === 'MFA_REQUIRED') {
    return COMMAND_STATUS_TEXT[command.status]!
  }
  if (command.phase && FORESIGHT_PHASE_TEXT[command.phase]) return FORESIGHT_PHASE_TEXT[command.phase]!
  return COMMAND_STATUS_TEXT[command.status] ?? 'K-Bot is ready for the next National Life task.'
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
