import { classifyIgoSurface, parseIgoProbeMessage } from '../lib/igo-gateway'

export default defineContentScript({
  matches: ['https://igoforms2.ipipeline.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
      const message = parseIgoProbeMessage(value)
      if (!message) return
      sendResponse({
        ok: true,
        type: 'IGO_SURFACE_PROBED',
        token: message.token,
        correlationId: message.correlationId,
        surface: classifyIgoSurface({
          bodyText: document.body?.innerText ?? '',
          formCount: document.forms.length,
        }),
      })
      return false
    })
  },
})
