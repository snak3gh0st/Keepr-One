import { popupCanRetry, popupStatusText } from '../../lib/popup-copy'
import type { DeviceState, SyncState } from '../../lib/state'

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('POPUP_UI_INVALID')
  return element
}

const statusElement = requiredElement<HTMLParagraphElement>('#status')
const popupElement = requiredElement<HTMLElement>('#popup')
const connectionElement = requiredElement<HTMLSpanElement>('#connection')
const openButton = requiredElement<HTMLButtonElement>('#open')
const retryButton = requiredElement<HTMLButtonElement>('#retry')

function render(device: DeviceState, sync: SyncState) {
  statusElement.textContent = popupStatusText(device, sync)
  retryButton.hidden = !popupCanRetry(device, sync)
  popupElement.dataset.device = device.status.toLowerCase()
  popupElement.dataset.sync = sync.status.toLowerCase()

  if (device.status !== 'READY') {
    connectionElement.textContent = device.status === 'PAIRING' ? 'Linking' : 'Not linked'
    openButton.textContent = 'Open Keepr One'
    return
  }

  connectionElement.textContent = sync.status === 'ERROR' ? 'Needs attention' : 'Connected'
  openButton.textContent = sync.status === 'AUTH_REQUIRED' ? 'Continue sign-in' : 'Open National Life'
}

async function refresh() {
  const response = (await chrome.runtime.sendMessage({ type: 'GET_STATUS' })) as {
    device: DeviceState
    sync: SyncState
  }
  render(response.device, response.sync)
}

async function act(button: HTMLButtonElement, type: 'OPEN_NLG' | 'RETRY_SYNC') {
  button.disabled = true
  try {
    await chrome.runtime.sendMessage({ type })
    await refresh()
  } finally {
    button.disabled = false
  }
}

openButton.addEventListener('click', () => void act(openButton, 'OPEN_NLG'))
retryButton.addEventListener('click', () => void act(retryButton, 'RETRY_SYNC'))

void refresh()
