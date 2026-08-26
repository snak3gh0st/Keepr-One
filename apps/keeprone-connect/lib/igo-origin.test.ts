import { describe, expect, it } from 'vitest'
import { classifyIgoLocation, isApprovedIgoOrigin } from './igo-origin'

describe('iGO exact-origin policy', () => {
  it.each([
    ['https://www.nationallife.com/agent/sso/igo-eapp', 'NATIONAL_LIFE_LAUNCHER'],
    ['https://nlg-prod.auth0.com/login', 'AUTH_REQUIRED'],
    ['https://nlg-prod.auth0.com/mfa', 'MFA_REQUIRED'],
    ['https://pipepasstoigo.ipipeline.com/start', 'IPIPELINE_GATEWAY'],
    ['https://federate.ipipeline.com/sso', 'IPIPELINE_FEDERATION'],
    ['https://igoforms2.ipipeline.com/CossEnterpriseSuite/webforms/StartUpResp.aspx', 'IGO_FORMS'],
  ])('classifies %s without returning its token-bearing path', (url, expected) => {
    expect(classifyIgoLocation(url)).toBe(expected)
  })

  it('rejects wildcard lookalikes and every unobserved host', () => {
    expect(classifyIgoLocation('https://evil.ipipeline.com/start')).toBe('UNEXPECTED_ORIGIN')
    expect(classifyIgoLocation('https://igoforms2.ipipeline.com.evil.example/start')).toBe('UNEXPECTED_ORIGIN')
    expect(isApprovedIgoOrigin('https://*.ipipeline.com')).toBe(false)
    expect(isApprovedIgoOrigin('https://igoforms2.ipipeline.com')).toBe(true)
  })
})
