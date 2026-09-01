import { ForesightExecutionError, executeForesightIllustration } from '../lib/foresight-executor'
import { executeForesightTermIllustration } from '../lib/foresight-term-executor'
import { parseExecuteForesightIllustrationMessage } from '../lib/foresight-messages'
import type { ForesightIllustrationSnapshot } from '../lib/foresight-contract'
import type { ForesightProgressPhase } from '../lib/foresight-progress'
import { createProgressReporter } from '../lib/progress-reporter'

function isFlexLifeSnapshot(snapshot: unknown): snapshot is ForesightIllustrationSnapshot {
  return typeof snapshot === 'object' && snapshot !== null &&
    'product' in snapshot && typeof snapshot.product === 'object' && snapshot.product !== null &&
    'code' in snapshot.product
}

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
      const progress = createProgressReporter<ForesightProgressPhase>((phase) =>
        chrome.runtime.sendMessage({ type: 'FORESIGHT_PROGRESS', phase }),
      )
      const onProgress = (phase: ForesightProgressPhase) => {
        progress.report(phase)
      }
      const execute = isFlexLifeSnapshot(message.snapshot)
        ? executeForesightIllustration({ inputHash: message.inputHash, snapshot: message.snapshot, onProgress })
        : executeForesightTermIllustration({ inputHash: message.inputHash, snapshot: message.snapshot, onProgress })
      void execute.then(
        async (result) => {
          await progress.flush()
          sendResponse({
            ok: true,
            type: 'FORESIGHT_ILLUSTRATION_SAVED',
            token: message.token,
            correlationId: message.correlationId,
            receipt: result.receipt,
            document: result.document,
          })
        },
        async (error: unknown) => {
          await progress.flush()
          sendResponse({
            ok: false,
            type: 'FORESIGHT_ILLUSTRATION_FAILED',
            token: message.token,
            correlationId: message.correlationId,
            code: error instanceof ForesightExecutionError
              ? error.code
              : 'FORESIGHT_EXECUTION_FAILED',
          })
        },
      ).finally(() => { running = false })
      return true
    })
  },
})
