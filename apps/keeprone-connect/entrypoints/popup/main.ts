import type { DeviceState, SyncState } from '../../lib/state'

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error('POPUP_UI_INVALID')
  return element
}

const statusElement = requiredElement<HTMLParagraphElement>('#status')
const openButton = requiredElement<HTMLButtonElement>('#open')
const retryButton = requiredElement<HTMLButtonElement>('#retry')

const STATUS_TEXT: Record<SyncState['status'], string> = {
  IDLE: 'Pronto para iniciar uma sincronização pelo KeeproneConnect.',
  STARTING: 'Preparando a sincronização…',
  NAVIGATING: 'Abrindo a área correta do National Life…',
  EXTRACTING: 'Lendo os dados exibidos pelo National Life…',
  UPLOADING: 'Enviando um lote protegido ao Keepr…',
  AUTH_REQUIRED: 'Entre no National Life. A sincronização continuará automaticamente.',
  COMPLETED: 'Sincronização concluída.',
  ERROR: 'Não foi possível concluir. Você pode tentar novamente.',
}

function render(device: DeviceState, sync: SyncState) {
  statusElement.textContent =
    device.status === 'READY'
      ? STATUS_TEXT[sync.status]
      : device.status === 'PAIRING'
        ? 'Conectando o KeeproneConnect ao Keepr…'
        : device.status === 'ERROR'
          ? 'A conexão do KeeproneConnect não foi concluída.'
          : 'Conecte o KeeproneConnect pela página de integração no Keepr.'
  retryButton.hidden = device.status !== 'READY' || !['AUTH_REQUIRED', 'ERROR'].includes(sync.status)
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
