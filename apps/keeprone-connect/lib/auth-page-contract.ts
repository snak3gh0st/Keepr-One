export type NationalLifeAuthPageClassification =
  | 'LOGIN'
  | 'MFA'
  | 'CAPTCHA'
  | 'REJECTED'
  | 'UNKNOWN'

export type CarrierCredentialV1 = Readonly<{
  formatVersion: 1
  username: string
  password: string
}>

export type SubmitCarrierCredentialMessage = Readonly<{
  type: 'SUBMIT_CARRIER_CREDENTIAL'
  credential: CarrierCredentialV1
}>

export type SubmitCarrierCredentialAck = Readonly<
  | { ok: true; code: 'SUBMITTED' }
  | {
      ok: false
      code: 'REFUSED_MESSAGE' | 'REFUSED_PAGE' | 'REFUSED_ALREADY_SUBMITTED'
    }
>

const AUTH0_ORIGIN = 'https://nlg-prod.auth0.com'
const AUTH0_LOGIN_PATH = '/login'
const submittedForms = new WeakSet<HTMLFormElement>()
export const NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL = 'KEEPRONE_NATIONAL_LIFE_AUTH_SUBMIT_V1'

function exactKeys(value: object, keys: readonly string[]) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isVisible(element: Element) {
  if (element.hasAttribute('hidden')) return false
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const parentStyle = view.getComputedStyle(parent)
    if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return false
  }
  return true
}

function actionMatches(form: HTMLFormElement, url: URL) {
  try {
    const action = new URL(form.action, url)
    return action.origin === AUTH0_ORIGIN && action.pathname === AUTH0_LOGIN_PATH &&
      !action.username && !action.password
  } catch {
    return false
  }
}

function exactInput(
  input: HTMLInputElement | null,
  contract: {
    id: string
    name: string
    type: string
    placeholder?: string
    ariaLabel?: string
  },
) {
  return Boolean(
    input &&
    input.id === contract.id &&
    input.name === contract.name &&
    input.type === contract.type &&
    input.autocomplete === '' &&
    !input.disabled &&
    (contract.placeholder === undefined || input.placeholder === contract.placeholder) &&
    (contract.ariaLabel === undefined || input.getAttribute('aria-label') === contract.ariaLabel),
  )
}

function exactLoginStructure(document: Document, url: URL) {
  if (document.forms.length !== 2 || document.querySelectorAll('input').length !== 4) return null
  const login = document.querySelector<HTMLFormElement>('form#loginForm')
  const mfa = document.querySelector<HTMLFormElement>('form#loginFormMFA')
  if (!login || !mfa || login.method.toUpperCase() !== 'GET' || mfa.method.toUpperCase() !== 'GET') {
    return null
  }
  if (!actionMatches(login, url) || !actionMatches(mfa, url)) return null
  if (
    login.querySelectorAll('input').length !== 3 ||
    mfa.querySelectorAll('input').length !== 1 ||
    document.querySelectorAll('input[type="password"]').length !== 1
  ) return null

  const email = login.querySelector<HTMLInputElement>('input#email')
  const password = login.querySelector<HTMLInputElement>('input#password')
  const remember = login.querySelector<HTMLInputElement>('input#chkRememberMe')
  const code = mfa.querySelector<HTMLInputElement>('input#code')
  if (
    !exactInput(email, {
      id: 'email', name: 'email', type: 'text',
      placeholder: 'Enter Username', ariaLabel: 'Enter Username',
    }) ||
    !exactInput(password, {
      id: 'password', name: 'password', type: 'password',
      placeholder: 'Enter Password', ariaLabel: 'Enter Password',
    }) ||
    !exactInput(remember, {
      id: 'chkRememberMe', name: 'chkRememberMe', type: 'checkbox', ariaLabel: 'Email',
    }) ||
    !exactInput(code, { id: 'code', name: 'code', type: 'text' })
  ) return null

  const loginButtons = login.querySelectorAll('button,input[type="submit"]')
  const mfaButtons = mfa.querySelectorAll('button,input[type="submit"]')
  if (loginButtons.length !== 1 || mfaButtons.length !== 1) return null
  const loginButton = loginButtons[0]
  const mfaButton = mfaButtons[0]
  if (
    !(loginButton instanceof (document.defaultView?.HTMLButtonElement ?? HTMLButtonElement)) ||
    loginButton.id !== 'btn-login' || loginButton.type !== 'submit' || loginButton.disabled ||
    loginButton.textContent?.trim() !== 'Login' ||
    !(mfaButton instanceof (document.defaultView?.HTMLButtonElement ?? HTMLButtonElement)) ||
    mfaButton.id !== 'entercodetxt' || mfaButton.type !== 'submit' || mfaButton.disabled ||
    mfaButton.textContent?.trim() !== 'Confirm Code'
  ) return null

  return { login, mfa, email: email!, password: password!, loginButton }
}

function hasCaptcha(document: Document) {
  return Boolean(document.querySelector(
    '[data-sitekey],iframe[src*="captcha" i],iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i]',
  ))
}

function hasVisibleRejection(document: Document) {
  const incorrect = [...document.querySelectorAll('#loginForm span.incorrectUser#error-message')]
    .some((element) => isVisible(element) &&
      element.textContent?.trim() === 'The Username or Password that you entered is incorrect. Please try again.')
  const blocked = [...document.querySelectorAll('#loginForm span.blocked#blocked-error-message')]
    .some((element) => isVisible(element))
  return incorrect || blocked
}

export function classifyNationalLifeAuthPage(
  document: Document,
  rawUrl: string,
): NationalLifeAuthPageClassification {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'UNKNOWN'
  }
  if (url.origin !== AUTH0_ORIGIN || url.pathname !== AUTH0_LOGIN_PATH) return 'UNKNOWN'
  if (hasCaptcha(document)) return 'CAPTCHA'
  const structure = exactLoginStructure(document, url)
  if (!structure) return 'UNKNOWN'
  const loginVisible = isVisible(structure.login)
  const mfaVisible = isVisible(structure.mfa)
  if (!loginVisible && mfaVisible) return 'MFA'
  if (!loginVisible || mfaVisible) return 'UNKNOWN'
  if (hasVisibleRejection(document)) return 'REJECTED'
  return 'LOGIN'
}

export function parseSubmitCarrierCredentialMessage(
  value: unknown,
): SubmitCarrierCredentialMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['type', 'credential'])) return null
  const message = value as Record<string, unknown>
  if (message.type !== 'SUBMIT_CARRIER_CREDENTIAL' ||
    !message.credential || typeof message.credential !== 'object' ||
    Array.isArray(message.credential) ||
    !exactKeys(message.credential, ['formatVersion', 'username', 'password'])) return null
  const credential = message.credential as Record<string, unknown>
  if (
    credential.formatVersion !== 1 ||
    typeof credential.username !== 'string' || credential.username.length < 1 ||
    credential.username.length > 128 || credential.username.trim().length === 0 ||
    typeof credential.password !== 'string' || credential.password.length < 1 ||
    credential.password.length > 256
  ) return null
  return {
    type: 'SUBMIT_CARRIER_CREDENTIAL',
    credential: {
      formatVersion: 1,
      username: credential.username,
      password: credential.password,
    },
  }
}

export function submitNationalLifeCredential(
  document: Document,
  rawUrl: string,
  credential: CarrierCredentialV1,
): SubmitCarrierCredentialAck {
  if (classifyNationalLifeAuthPage(document, rawUrl) !== 'LOGIN') {
    return { ok: false, code: 'REFUSED_PAGE' }
  }
  const structure = exactLoginStructure(document, new URL(rawUrl))
  if (!structure) return { ok: false, code: 'REFUSED_PAGE' }
  if (submittedForms.has(structure.login)) {
    return { ok: false, code: 'REFUSED_ALREADY_SUBMITTED' }
  }
  submittedForms.add(structure.login)
  const view = document.defaultView
  if (!view) return { ok: false, code: 'REFUSED_PAGE' }
  structure.email.value = credential.username
  structure.password.value = credential.password
  for (const input of [structure.email, structure.password]) {
    input.dispatchEvent(new view.Event('input', { bubbles: true }))
    input.dispatchEvent(new view.Event('change', { bubbles: true }))
  }
  // Content scripts run in Chrome's isolated world. National Life installs its
  // webAuth.login click listener in the page's MAIN world, so clicking here can
  // leave the visibly populated form untouched. Cross only a fixed,
  // credential-free signal; the MAIN-world executor revalidates the exact page
  // before activating the carrier's own handler.
  view.postMessage({
    channel: NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL,
    type: 'SUBMIT_LOGIN',
  }, AUTH0_ORIGIN)
  return { ok: true, code: 'SUBMITTED' }
}

export function activateNationalLifeLoginInMainWorld(
  document: Document,
  rawUrl: string,
): boolean {
  if (classifyNationalLifeAuthPage(document, rawUrl) !== 'LOGIN') return false
  const structure = exactLoginStructure(document, new URL(rawUrl))
  if (!structure || !structure.email.value.trim() || !structure.password.value.trim()) return false
  structure.loginButton.click()
  return true
}
