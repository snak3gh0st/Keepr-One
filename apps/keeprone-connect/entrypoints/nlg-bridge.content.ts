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

    chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
      const begin = parseBeginGridMessage(value)
      if (begin) {
        active = begin
        window.postMessage({ channel: CHANNEL, payload: begin }, location.origin)
        sendResponse({
          ok: true,
          type: 'BEGIN_GRID_ACK',
          gridKey: begin.gridKey,
          token: begin.token,
          correlationId: begin.correlationId,
        })
        return false
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
      sendResponse({
        ok: true,
        type: 'ABORT_GRID_ACK',
        gridKey: abort.gridKey,
        token: abort.token,
        correlationId: abort.correlationId,
      })
      active = null
      return false
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
      // A terminal message is only retired after the service worker confirms that
      // it processed the upload/finish. Before this, the bridge cleared `active`
      // immediately and a closed message channel could lose the only GRID_DONE.
      void chrome.runtime.sendMessage(message).then(
        (response) => {
          if (
            response?.ok === true &&
            (message.type === 'GRID_DONE' || message.type === 'GRID_ERROR')
          ) {
            active = null
          }
        },
        () => {
          // The background records the failure; swallowing here prevents an
          // unchecked runtime.lastError from hiding the real sync status.
        },
      )
    })
  },
})
