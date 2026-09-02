import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import {
  NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL,
  activateNationalLifeLoginInMainWorld,
  classifyNationalLifeAuthPage,
  submitNationalLifeCredential,
} from './auth-page-contract'

function fixture(name: string, url = 'https://nlg-prod.auth0.com/login') {
  const html = readFileSync(
    new URL(`../../../tests/fixtures/national-life/${name}.html`, import.meta.url),
    'utf8',
  )
  return new JSDOM(html, { url })
}

describe('National Life authentication page contract', () => {
  it('accepts only the exact observed Auth0 login form', () => {
    const login = fixture('auth0-login')
    expect(classifyNationalLifeAuthPage(login.window.document, login.window.location.href)).toBe('LOGIN')

    const lookalike = fixture('auth0-login', 'https://nlg-prod.auth0.example.com/login')
    expect(classifyNationalLifeAuthPage(lookalike.window.document, lookalike.window.location.href))
      .toBe('UNKNOWN')
    const unexpectedPath = fixture('auth0-login', 'https://nlg-prod.auth0.com/authorize')
    expect(classifyNationalLifeAuthPage(unexpectedPath.window.document, unexpectedPath.window.location.href))
      .toBe('UNKNOWN')
    const nationalLifeRedirect = fixture(
      'auth0-login',
      'https://www.nationallife.com/agent/auth/login',
    )
    expect(classifyNationalLifeAuthPage(
      nationalLifeRedirect.window.document,
      nationalLifeRedirect.window.location.href,
    )).toBe('UNKNOWN')
  })

  it('refuses duplicates, cross-origin actions, visible extra OTP and unknown forms', () => {
    const duplicate = fixture('auth0-login')
    const hiddenPassword = duplicate.window.document.createElement('input')
    hiddenPassword.type = 'password'
    hiddenPassword.hidden = true
    duplicate.window.document.querySelector('#loginForm')!.append(hiddenPassword)
    expect(classifyNationalLifeAuthPage(duplicate.window.document, duplicate.window.location.href))
      .toBe('UNKNOWN')

    const crossOrigin = fixture('auth0-login')
    crossOrigin.window.document.querySelector('#loginForm')!
      .setAttribute('action', 'https://lookalike.example/login')
    expect(classifyNationalLifeAuthPage(crossOrigin.window.document, crossOrigin.window.location.href))
      .toBe('UNKNOWN')

    const extraOtp = fixture('auth0-login')
    const otp = extraOtp.window.document.createElement('input')
    otp.name = 'otp'
    extraOtp.window.document.querySelector('#loginForm')!.append(otp)
    expect(classifyNationalLifeAuthPage(extraOtp.window.document, extraOtp.window.location.href))
      .toBe('UNKNOWN')

    const multipleForms = fixture('auth0-login')
    multipleForms.window.document.body.append(multipleForms.window.document.createElement('form'))
    expect(classifyNationalLifeAuthPage(multipleForms.window.document, multipleForms.window.location.href))
      .toBe('UNKNOWN')
  })

  it('classifies MFA, CAPTCHA and rejection without reading any field value', () => {
    for (const [name, expected] of [
      ['auth0-mfa', 'MFA'],
      ['auth0-captcha', 'CAPTCHA'],
      ['auth0-rejected', 'REJECTED'],
    ] as const) {
      const page = fixture(name)
      const inputs = [...page.window.document.querySelectorAll('input')]
      for (const input of inputs) {
        Object.defineProperty(input, 'value', {
          get() { throw new Error('FIELD_VALUE_MUST_NOT_BE_READ') },
          set() { throw new Error('FIELD_VALUE_MUST_NOT_BE_WRITTEN') },
          configurable: true,
        })
      }
      expect(() => classifyNationalLifeAuthPage(page.window.document, page.window.location.href))
        .not.toThrow()
      expect(classifyNationalLifeAuthPage(page.window.document, page.window.location.href)).toBe(expected)
    }
  })

  it('fills the two exact inputs and requests a credential-free main-world submit once', () => {
    const page = fixture('auth0-login')
    const clicked = vi.fn()
    page.window.document.querySelector('#btn-login')?.addEventListener('click', clicked)
    const postMessage = vi.spyOn(page.window, 'postMessage')

    const acknowledgement = submitNationalLifeCredential(
      page.window.document,
      page.window.location.href,
      { formatVersion: 1, username: 'sentinel-user', password: 'sentinel-pass' },
    )
    expect(acknowledgement).toEqual({ ok: true, code: 'SUBMITTED' })
    expect(page.window.document.querySelector<HTMLInputElement>('#email')?.value).toBe('sentinel-user')
    expect(page.window.document.querySelector<HTMLInputElement>('#password')?.value).toBe('sentinel-pass')
    // O login normal da National Life mantém a confiança já escolhida pelo
    // usuário. O K-Bot preenche somente usuário e senha; ele não desmarca nem
    // substitui a preferência "Remember this device" do portal.
    expect(page.window.document.querySelector<HTMLInputElement>('#chkRememberMe')?.checked).toBe(true)
    expect(clicked).not.toHaveBeenCalled()
    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage).toHaveBeenCalledWith({
      channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL,
      type: 'SUBMIT_LOGIN',
    }, 'https://nlg-prod.auth0.com')
    expect(JSON.stringify(postMessage.mock.calls)).not.toMatch(/sentinel|username|password/)
    expect(JSON.stringify(acknowledgement)).not.toMatch(/sentinel|username|password/)

    expect(submitNationalLifeCredential(
      page.window.document,
      page.window.location.href,
      { formatVersion: 1, username: 'sentinel-user', password: 'sentinel-pass' },
    )).toEqual({ ok: false, code: 'REFUSED_ALREADY_SUBMITTED' })
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('activates the exact National Life handler only from the main-world executor', () => {
    const page = fixture('auth0-login')
    const email = page.window.document.querySelector<HTMLInputElement>('#email')!
    const password = page.window.document.querySelector<HTMLInputElement>('#password')!
    email.value = 'sentinel-user'
    password.value = 'sentinel-pass'
    const clicked = vi.fn((event: Event) => event.preventDefault())
    page.window.document.querySelector('#btn-login')?.addEventListener('click', clicked)

    expect(activateNationalLifeLoginInMainWorld(
      page.window.document,
      page.window.location.href,
    )).toBe(true)
    expect(clicked).toHaveBeenCalledOnce()

    password.value = ''
    expect(activateNationalLifeLoginInMainWorld(
      page.window.document,
      page.window.location.href,
    )).toBe(false)
    expect(clicked).toHaveBeenCalledOnce()
  })
})
