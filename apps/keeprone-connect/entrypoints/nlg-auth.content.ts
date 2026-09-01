import { handleNationalLifeAuthCredentialMessage } from '../lib/auth-content-handler'

export default defineContentScript({
  matches: [
    'https://www.nationallife.com/agent/auth/*',
    'https://nlg-prod.auth0.com/login*',
  ],
  runAt: 'document_idle' as const,
  main() {
    if (window.top !== window) return
    chrome.runtime.onMessage.addListener((value, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return false
      sendResponse(handleNationalLifeAuthCredentialMessage(value, document, location.href))
      return false
    })
  },
})
