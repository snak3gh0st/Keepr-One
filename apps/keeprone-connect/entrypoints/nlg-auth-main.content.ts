import { handleNationalLifeAuthSubmitBridgeMessage } from '../lib/auth-main-bridge'

export default defineContentScript({
  matches: ['https://nlg-prod.auth0.com/login*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    if (window.top !== window) return
    window.addEventListener('message', (event) => {
      handleNationalLifeAuthSubmitBridgeMessage({
        data: event.data,
        origin: event.origin,
        sourceIsWindow: event.source === window,
        document,
        url: location.href,
      })
    })
  },
})
