import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { handleNationalLifeAuthCredentialMessage } from '../lib/auth-content-handler'

function loginPage() {
  return new JSDOM(readFileSync(
    new URL('../../../tests/fixtures/national-life/auth0-login.html', import.meta.url),
    'utf8',
  ), { url: 'https://nlg-prod.auth0.com/login' })
}

describe('isolated National Life auth content script', () => {
  it('returns only the safe page classification for an exact private probe', () => {
    const page = loginPage()
    expect(handleNationalLifeAuthCredentialMessage(
      { type: 'CLASSIFY_CARRIER_AUTH_PAGE' },
      page.window.document,
      page.window.location.href,
    )).toEqual({ ok: true, code: 'LOGIN' })
  })

  it('accepts only its private exact message and returns a redacted acknowledgement', () => {
    const page = loginPage()
    page.window.document.querySelector('#btn-login')?.addEventListener('click', (event) => {
      event.preventDefault()
    })
    const result = handleNationalLifeAuthCredentialMessage({
      type: 'SUBMIT_CARRIER_CREDENTIAL',
      credential: {
        formatVersion: 1,
        username: 'sentinel-user',
        password: 'sentinel-pass',
      },
    }, page.window.document, page.window.location.href)
    expect(result).toEqual({ ok: true, code: 'SUBMITTED' })
    expect(JSON.stringify(result)).not.toMatch(/sentinel|username|password/)
  })

  it.each([
    { type: 'SUBMIT_CARRIER_CREDENTIAL', username: 'user', password: 'pass' },
    { type: 'SUBMIT_CARRIER_CREDENTIAL', credential: { formatVersion: 1, username: 'user', password: 'pass' }, extra: true },
    { type: 'SUBMIT_CARRIER_CREDENTIAL', credential: { formatVersion: 1, username: 'user', password: 'pass', otp: '123456' } },
  ])('refuses loose credential-bearing messages', (message) => {
    const page = loginPage()
    expect(handleNationalLifeAuthCredentialMessage(
      message,
      page.window.document,
      page.window.location.href,
    )).toEqual({ ok: false, code: 'REFUSED_MESSAGE' })
  })
})
