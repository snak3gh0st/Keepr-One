import { describe, expect, it } from 'vitest'
import { isAuthenticatedAgentResponse } from './auth-probe'

describe('National Life authenticated-session proof', () => {
  it('accepts only a successful response from a non-authenticated agent path', () => {
    expect(isAuthenticatedAgentResponse({
      ok: true,
      type: 'basic',
      url: 'https://www.nationallife.com/agent/',
    })).toBe(true)
  })

  it('rejects redirects, Auth0, and National Life authentication callbacks', () => {
    expect(isAuthenticatedAgentResponse({ ok: false, type: 'opaqueredirect', url: '' })).toBe(false)
    expect(isAuthenticatedAgentResponse({
      ok: true,
      type: 'basic',
      url: 'https://nlg-prod.auth0.com/login',
    })).toBe(false)
    expect(isAuthenticatedAgentResponse({
      ok: true,
      type: 'basic',
      url: 'https://www.nationallife.com/agent/auth/mfacallback',
    })).toBe(false)
  })
})
