import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from './constants'

/// A URL inside `/agent/*` is not enough to prove authentication: callbacks and
/// branded login interstitials can live there too. The probe follows no
/// redirects, so an authenticated 200 from the ordinary agent shell is the only
/// accepted result. Everything ambiguous fails closed and returns to login.
export function isAuthenticatedAgentResponse(response: Pick<Response, 'ok' | 'type' | 'url'>): boolean {
  if (!response.ok || response.type === 'opaqueredirect') return false
  try {
    const url = new URL(response.url)
    return url.origin === NLG_ORIGIN && shouldInstrumentNationalLifePath(url.pathname)
  } catch {
    return false
  }
}
