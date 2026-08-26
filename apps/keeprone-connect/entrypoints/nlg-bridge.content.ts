import {
  parseAbortGridMessage,
  parseBeginGridMessage,
  parseBridgeMessage,
  parseCapturePageMessage,
  parseCapturePolicyDetailMessage,
  parseBeginDocumentMessage,
  parseBeginExportMessage,
  parseProbeAuthMessage,
  parseExecuteFlexLifeQuoteMessage,
  parseFlexLifeQuoteMainResult,
  type BeginGridMessage,
  type BeginDocumentMessage,
} from '../lib/messages'
import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from '../lib/constants'
import { isAuthenticatedAgentResponse } from '../lib/auth-probe'
import { capturePageSnapshot } from '../lib/page-snapshot'
import { captureNationalLifePolicyDetail } from '../lib/policy-detail'

const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'

export default defineContentScript({
  matches: ['https://www.nationallife.com/agent/*'],
  runAt: 'document_start',
  main() {
    if (!shouldInstrumentNationalLifePath(location.pathname)) return
    let active: BeginGridMessage |
      { type: 'BEGIN_EXPORT'; sourceKey: 'INFORCE_CLIENTS'; token: string; correlationId: string } |
      BeginDocumentMessage |
      null = null
    const quoteResponses = new Map<string, {
      inputHash: string
      timer: ReturnType<typeof setTimeout>
      sendResponse: (value: unknown) => void
    }>()

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
      const quote = parseExecuteFlexLifeQuoteMessage(value)
      if (quote) {
        const key = `${quote.token}:${quote.correlationId}`
        if (quoteResponses.has(key)) return false
        const timer = setTimeout(() => {
          const pending = quoteResponses.get(key)
          if (!pending) return
          quoteResponses.delete(key)
          pending.sendResponse({
            ok: false,
            type: 'FLEXLIFE_QUOTE_FAILED',
            token: quote.token,
            correlationId: quote.correlationId,
            inputHash: quote.inputHash,
            code: 'PORTAL_REQUEST_FAILED',
          })
        }, 65_000)
        quoteResponses.set(key, { inputHash: quote.inputHash, timer, sendResponse })
        window.postMessage({ channel: CHANNEL, payload: quote }, location.origin)
        return true
      }
      const policyDetail = parseCapturePolicyDetailMessage(value)
      if (policyDetail) {
        const currentUrl = new URL(location.href)
        const currentPath = `${currentUrl.pathname}${currentUrl.search}`
        if (currentPath !== policyDetail.navigatePath) {
          sendResponse({
            ok: false,
            type: 'POLICY_DETAIL_CAPTURE_FAILED',
            token: policyDetail.token,
            correlationId: policyDetail.correlationId,
            code: 'POLICY_DETAIL_PATH_MISMATCH',
          })
          return false
        }
        void captureNationalLifePolicyDetail(document, {
          navigatePath: policyDetail.navigatePath,
          expectedPolicyNumber: policyDetail.expectedPolicyNumber,
        }).then(
          (detail) => sendResponse({
            ok: true,
            type: 'POLICY_DETAIL_CAPTURED',
            token: policyDetail.token,
            correlationId: policyDetail.correlationId,
            detail,
          }),
          (error: unknown) => sendResponse({
            ok: false,
            type: 'POLICY_DETAIL_CAPTURE_FAILED',
            token: policyDetail.token,
            correlationId: policyDetail.correlationId,
            code: error instanceof Error && [
              'POLICY_DETAIL_TARGET_MISMATCH',
              'POLICY_DETAIL_SECTION_UNAVAILABLE',
            ].includes(error.message)
              ? error.message
              : 'POLICY_DETAIL_CAPTURE_FAILED',
          }),
        )
        return true
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
      const beginDocument = parseBeginDocumentMessage(value)
      if (beginDocument) {
        active = beginDocument
        window.postMessage({ channel: CHANNEL, payload: beginDocument }, location.origin)
        sendResponse({
          ok: true,
          type: 'BEGIN_DOCUMENT_ACK',
          transferId: beginDocument.transferId,
          token: beginDocument.token,
          correlationId: beginDocument.correlationId,
        })
        return false
      }

      // A ordem de parar atravessa para a página pelo mesmo canal, e só se falar
      // da extração que esta ponte está acompanhando: uma ordem com token de
      // outra extração pararia a errada.
      const abort = parseAbortGridMessage(value)
      const activeGridKey = active && ('gridKey' in active
        ? active.gridKey
        : 'sourceKey' in active ? active.sourceKey : null)
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
      const quote = parseFlexLifeQuoteMainResult(event.data.payload)
      if (quote) {
        const key = `${quote.token}:${quote.correlationId}`
        const pending = quoteResponses.get(key)
        if (!pending || pending.inputHash !== quote.inputHash) return
        clearTimeout(pending.timer)
        quoteResponses.delete(key)
        pending.sendResponse(quote.type === 'FLEXLIFE_QUOTE_DONE'
          ? {
              ok: true,
              type: 'FLEXLIFE_QUOTE_RECEIVED',
              token: quote.token,
              correlationId: quote.correlationId,
              inputHash: quote.inputHash,
              response: quote.response,
            }
          : {
              ok: false,
              type: 'FLEXLIFE_QUOTE_FAILED',
              token: quote.token,
              correlationId: quote.correlationId,
              inputHash: quote.inputHash,
              code: quote.code,
            })
        return
      }
      const message = parseBridgeMessage(event.data.payload)
      if (!message || !active || message.token !== active.token || message.correlationId !== active.correlationId) {
        return
      }
      const matchesActive = 'transferId' in message
        ? 'transferId' in active && message.transferId === active.transferId
        : !('transferId' in active) && message.gridKey === ('gridKey' in active ? active.gridKey : active.sourceKey)
      if (!matchesActive) return
      // A terminal message is only retired after the service worker confirms that
      // it processed the upload/finish. Before this, the bridge cleared `active`
      // immediately and a closed message channel could lose the only GRID_DONE.
      void chrome.runtime.sendMessage(message).then(
        (response) => {
          if (
            response?.ok === true &&
            (message.type === 'GRID_DONE' || message.type === 'GRID_ERROR' ||
              message.type === 'EXPORT_DONE' || message.type === 'EXPORT_ERROR' ||
              message.type === 'DOCUMENT_DONE' || message.type === 'DOCUMENT_ERROR')
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
