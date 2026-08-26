import { ForesightExecutionError, executeForesightIllustration } from '../lib/foresight-executor'
import { parseExecuteForesightIllustrationMessage } from '../lib/foresight-messages'

export default defineContentScript({
  matches: ['https://www.nationallife.com/NWI/*'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window || location.pathname !== '/NWI/Main/Layout.aspx') return
    let running = false
    chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
      const message = parseExecuteForesightIllustrationMessage(value)
      if (!message) return
      if (running) {
        sendResponse({
          ok: false,
          type: 'FORESIGHT_ILLUSTRATION_FAILED',
          token: message.token,
          correlationId: message.correlationId,
          code: 'FORESIGHT_EXECUTION_BUSY',
        })
        return false
      }
      running = true
      void executeForesightIllustration({
        inputHash: message.inputHash,
        snapshot: message.snapshot,
      }).then(
        (result) => sendResponse({
          ok: true,
          type: 'FORESIGHT_ILLUSTRATION_SAVED',
          token: message.token,
          correlationId: message.correlationId,
          receipt: result.receipt,
          document: result.document,
        }),
        (error: unknown) => sendResponse({
          ok: false,
          type: 'FORESIGHT_ILLUSTRATION_FAILED',
          token: message.token,
          correlationId: message.correlationId,
          code: error instanceof ForesightExecutionError
            ? error.code
            : 'FORESIGHT_EXECUTION_FAILED',
        }),
      ).finally(() => { running = false })
      return true
    })
  },
})
