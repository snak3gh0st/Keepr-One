import { popupCanRetry, popupStatusText } from '../../lib/popup-copy'
import type { DeviceState, SyncState } from '../../lib/state'

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('POPUP_UI_INVALID')
  return element
}

const statusElement = requiredElement<HTMLParagraphElement>('#status')
const openButton = requiredElement<HTMLButtonElement>('#open')
const retryButton = requiredElement<HTMLButtonElement>('#retry')

function render(device: DeviceState, sync: SyncState) {
  statusElement.textContent = popupStatusText(device, sync)
  retryButton.hidden = !popupCanRetry(device, sync)
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
