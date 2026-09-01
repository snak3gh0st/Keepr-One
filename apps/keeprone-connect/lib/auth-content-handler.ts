import {
  classifyNationalLifeAuthPage,
  parseSubmitCarrierCredentialMessage,
  submitNationalLifeCredential,
  type SubmitCarrierCredentialAck,
} from './auth-page-contract'

type NationalLifeAuthContentAck = SubmitCarrierCredentialAck | {
  ok: true
  code: 'LOGIN' | 'MFA' | 'CAPTCHA' | 'REJECTED' | 'UNKNOWN'
}

export function handleNationalLifeAuthCredentialMessage(
  value: unknown,
  document: Document,
  url: string,
): NationalLifeAuthContentAck {
  if (value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { type?: unknown }).type === 'CLASSIFY_CARRIER_AUTH_PAGE') {
    return { ok: true, code: classifyNationalLifeAuthPage(document, url) }
  }
  const message = parseSubmitCarrierCredentialMessage(value)
  if (!message) return { ok: false, code: 'REFUSED_MESSAGE' }
  let credential: typeof message.credential | undefined = message.credential
  try {
    try {
      return submitNationalLifeCredential(document, url, credential)
    } catch {
      return { ok: false, code: 'REFUSED_PAGE' }
    }
  } finally {
    credential = undefined
  }
}
