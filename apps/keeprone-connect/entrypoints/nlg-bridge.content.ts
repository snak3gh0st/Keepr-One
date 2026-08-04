import { parseBeginGridMessage, parseBridgeMessage, type BeginGridMessage } from '../lib/messages'

const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'

export default defineContentScript({
  matches: ['https://www.nationallife.com/agent/*'],
  runAt: 'document_start',
  main() {
    let active: BeginGridMessage | null = null

    chrome.runtime.onMessage.addListener((value) => {
      const message = parseBeginGridMessage(value)
      if (!message) return
      active = message
      window.postMessage({ channel: CHANNEL, payload: message }, location.origin)
    })

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return
      if (typeof event.data !== 'object' || event.data === null || event.data.channel !== CHANNEL) return
      const message = parseBridgeMessage(event.data.payload)
      if (
        !message ||
        !active ||
        message.token !== active.token ||
        message.correlationId !== active.correlationId ||
        message.gridKey !== active.gridKey
      ) {
        return
      }
      void chrome.runtime.sendMessage(message)
      if (message.type === 'GRID_DONE' || message.type === 'GRID_ERROR') active = null
    })
  },
})
