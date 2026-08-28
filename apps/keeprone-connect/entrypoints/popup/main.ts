import { popupCanRetry, popupCommandStatusText, popupSyncStatusText } from '../../lib/popup-copy'
import type { CommandState, DeviceState, SyncState } from '../../lib/state'

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('POPUP_UI_INVALID')
  return element
}

const syncStatusElement = requiredElement<HTMLParagraphElement>('#sync-status')
const commandStatusElement = requiredElement<HTMLParagraphElement>('#command-status')
const commandRowElement = requiredElement<HTMLElement>('#command-row')
const popupElement = requiredElement<HTMLElement>('#popup')
const connectionElement = requiredElement<HTMLSpanElement>('#connection')
const openButton = requiredElement<HTMLButtonElement>('#open')
const retryButton = requiredElement<HTMLButtonElement>('#retry')
let deviceStatus: DeviceState['status'] = 'UNPAIRED'

function render(device: DeviceState, sync: SyncState, command?: CommandState) {
  deviceStatus = device.status
  syncStatusElement.textContent = popupSyncStatusText(device, sync)
  const showCommand = Boolean(command && command.status !== 'IDLE')
  commandRowElement.hidden = !showCommand
  commandStatusElement.textContent = command && showCommand ? popupCommandStatusText(command) : ''
  retryButton.hidden = !popupCanRetry(device, sync)
  popupElement.dataset.device = device.status.toLowerCase()
  popupElement.dataset.sync = sync.status.toLowerCase()
  popupElement.dataset.command = command?.status.toLowerCase() ?? 'idle'

  if (device.status !== 'READY') {
    connectionElement.textContent = device.status === 'PAIRING' ? 'Linking' : 'Not linked'
    openButton.textContent = 'Open Keepr One'
    return
  }

  connectionElement.textContent = sync.status === 'ERROR' || command?.status === 'ERROR' ? 'Needs attention' : 'Connected'
  openButton.textContent = sync.status === 'AUTH_REQUIRED' ||
    command?.status === 'AUTH_REQUIRED' || command?.status === 'MFA_REQUIRED'
    ? 'Continue sign-in'
    : 'Open National Life'
}

async function refresh() {
  const response = (await chrome.runtime.sendMessage({ type: 'GET_STATUS' })) as {
    device: DeviceState
    sync: SyncState
    command?: CommandState
  }
  render(response.device, response.sync, response.command)
}

async function act(button: HTMLButtonElement, type: 'OPEN_KEEPR' | 'OPEN_NLG' | 'RETRY_SYNC') {
  button.disabled = true
  try {
    await chrome.runtime.sendMessage({ type })
    await refresh()
  } finally {
    button.disabled = false
  }
}

openButton.addEventListener('click', () =>
  void act(openButton, deviceStatus === 'READY' ? 'OPEN_NLG' : 'OPEN_KEEPR'),
)
retryButton.addEventListener('click', () => void act(retryButton, 'RETRY_SYNC'))

void refresh()
