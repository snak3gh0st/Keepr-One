import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL } from './auth-page-contract'
import { handleNationalLifeAuthSubmitBridgeMessage } from './auth-main-bridge'

function loginPage() {
  return new JSDOM(readFileSync(
    new URL('../../../tests/fixtures/national-life/auth0-login.html', import.meta.url),
    'utf8',
  ), { url: 'https://nlg-prod.auth0.com/login' })
}

describe('National Life main-world authentication bridge', () => {
  it('clicks the exact login handler for the exact credential-free signal', () => {
    const page = loginPage()
    page.window.document.querySelector<HTMLInputElement>('#email')!.value = 'sentinel-user'
    page.window.document.querySelector<HTMLInputElement>('#password')!.value = 'sentinel-pass'
    const clicked = vi.fn((event: Event) => event.preventDefault())
    page.window.document.querySelector('#btn-login')?.addEventListener('click', clicked)

    expect(handleNationalLifeAuthSubmitBridgeMessage({
      data: { channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL, type: 'SUBMIT_LOGIN' },
      origin: page.window.location.origin,
      sourceIsWindow: true,
      document: page.window.document,
      url: page.window.location.href,
    })).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()
  })

  it.each([
    { data: { channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL, type: 'SUBMIT_LOGIN' }, origin: 'https://lookalike.example', sourceIsWindow: true },
    { data: { channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL, type: 'SUBMIT_LOGIN', password: 'must-not-cross' }, origin: 'https://nlg-prod.auth0.com', sourceIsWindow: true },
    { data: { channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL, type: 'SUBMIT_LOGIN' }, origin: 'https://nlg-prod.auth0.com', sourceIsWindow: false },
  ])('refuses a signal outside the exact bridge contract', ({ data, origin, sourceIsWindow }) => {
    const page = loginPage()
    page.window.document.querySelector<HTMLInputElement>('#email')!.value = 'sentinel-user'
    page.window.document.querySelector<HTMLInputElement>('#password')!.value = 'sentinel-pass'
    const clicked = vi.fn((event: Event) => event.preventDefault())
    page.window.document.querySelector('#btn-login')?.addEventListener('click', clicked)

    expect(handleNationalLifeAuthSubmitBridgeMessage({
      data,
      origin,
      sourceIsWindow,
      document: page.window.document,
      url: page.window.location.href,
    })).toBe(false)
    expect(clicked).not.toHaveBeenCalled()
  })
})
