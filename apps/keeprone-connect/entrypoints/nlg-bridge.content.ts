import {
  parseAbortGridMessage,
  parseBeginGridMessage,
  parseBridgeMessage,
  parseCapturePageMessage,
  parseBeginExportMessage,
  parseProbeAuthMessage,
  type BeginGridMessage,
} from '../lib/messages'
import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from '../lib/constants'
import { isAuthenticatedAgentResponse } from '../lib/auth-probe'
import { capturePageSnapshot } from '../lib/page-snapshot'

const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'

export default defineContentScript({
  matches: ['https://www.nationallife.com/agent/*'],
  runAt: 'document_start',
  main() {
    if (!shouldInstrumentNationalLifePath(location.pathname)) return
    let active: BeginGridMessage | { type: 'BEGIN_EXPORT'; sourceKey: 'INFORCE_CLIENTS'; token: string; correlationId: string } | null = null

    chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
      const probe = parseProbeAuthMessage(value)
      if (probe) {
        void fetch(`${NLG_ORIGIN}/agent/`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          redirect: 'manual',
        }).then(
          (response) => {
            sendResponse({
              ok: true,
              type: 'AUTH_PROBED',
              token: probe.token,
              correlationId: probe.correlationId,
              authenticated: isAuthenticatedAgentResponse(response),
            })
          },
          () => sendResponse({
            ok: true,
            type: 'AUTH_PROBED',
            token: probe.token,
            correlationId: probe.correlationId,
            authenticated: false,
          }),
        )
        return true
      }
      const capture = parseCapturePageMessage(value)
      if (capture) {
        sendResponse({
          ok: true,
          type: 'PAGE_CAPTURED',
          sourceKey: capture.sourceKey,
          token: capture.token,
          correlationId: capture.correlationId,
          records: capturePageSnapshot(document, new URL(location.href)),
        })
        return false
      }
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
      const beginExport = parseBeginExportMessage(value)
      if (beginExport) {
        active = beginExport
        window.postMessage({ channel: CHANNEL, payload: beginExport }, location.origin)
        sendResponse({
          ok: true,
          type: 'BEGIN_EXPORT_ACK',
          gridKey: beginExport.sourceKey,
          token: beginExport.token,
          correlationId: beginExport.correlationId,
        })
        return false
      }

      // A ordem de parar atravessa para a página pelo mesmo canal, e só se falar
      // da extração que esta ponte está acompanhando: uma ordem com token de
      // outra extração pararia a errada.
      const abort = parseAbortGridMessage(value)
      const activeGridKey = active && ('gridKey' in active ? active.gridKey : active.sourceKey)
      if (
        !abort ||
        !active ||
        abort.token !== active.token ||
        abort.correlationId !== active.correlationId ||
        abort.gridKey !== activeGridKey
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
        message.gridKey !== ('gridKey' in active ? active.gridKey : active.sourceKey)
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
            (message.type === 'GRID_DONE' || message.type === 'GRID_ERROR' || message.type === 'EXPORT_DONE' || message.type === 'EXPORT_ERROR')
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
