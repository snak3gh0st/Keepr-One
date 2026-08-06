import {
  parseAbortGridMessage,
  parseBeginGridMessage,
  parseBridgeMessage,
  type BeginGridMessage,
} from '../lib/messages'

const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'

export default defineContentScript({
  matches: ['https://www.nationallife.com/agent/*'],
  runAt: 'document_start',
  main() {
    let active: BeginGridMessage | null = null

    chrome.runtime.onMessage.addListener((value) => {
      const begin = parseBeginGridMessage(value)
      if (begin) {
        active = begin
        window.postMessage({ channel: CHANNEL, payload: begin }, location.origin)
        return
      }

      // A ordem de parar atravessa para a página pelo mesmo canal, e só se falar
      // da extração que esta ponte está acompanhando: uma ordem com token de
      // outra extração pararia a errada.
      const abort = parseAbortGridMessage(value)
      if (
        !abort ||
        !active ||
        abort.token !== active.token ||
        abort.correlationId !== active.correlationId ||
        abort.gridKey !== active.gridKey
      ) {
        return
      }
      window.postMessage({ channel: CHANNEL, payload: abort }, location.origin)
      active = null
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
