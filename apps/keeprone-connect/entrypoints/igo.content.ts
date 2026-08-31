import { IgoExecutionError, executeIgoApplicationDraft } from '../lib/igo-executor'
import { parseExecuteIgoApplicationDraftMessage } from '../lib/igo-messages'

export default defineContentScript({
  matches: ['https://igoforms2.ipipeline.com/CossEnterpriseSuite/*'],
  runAt: 'document_idle',
  main() {
    if (window.top !== window || location.origin !== 'https://igoforms2.ipipeline.com') return
    let running = false
    chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
      const message = parseExecuteIgoApplicationDraftMessage(value)
      if (!message) return
      if (running) {
        sendResponse({
          ok: false,
          type: 'IGO_APPLICATION_DRAFT_FAILED',
          token: message.token,
          correlationId: message.correlationId,
          code: 'IGO_EXECUTION_BUSY',
        })
        return false
      }
      running = true
      void executeIgoApplicationDraft({
        payloadHash: message.payloadHash,
        snapshot: message.snapshot,
      }).then(
        (receipt) => sendResponse({
          ok: true,
          type: 'IGO_APPLICATION_DRAFT_SAVED',
          token: message.token,
          correlationId: message.correlationId,
          receipt,
        }),
        (error: unknown) => sendResponse({
          ok: false,
          type: 'IGO_APPLICATION_DRAFT_FAILED',
          token: message.token,
          correlationId: message.correlationId,
          code: error instanceof IgoExecutionError ? error.code : 'IGO_EXECUTION_FAILED',
        }),
      ).finally(() => { running = false })
      return true
    })
  },
})
