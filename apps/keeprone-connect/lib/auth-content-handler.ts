import {
  parseSubmitCarrierCredentialMessage,
  submitNationalLifeCredential,
  type SubmitCarrierCredentialAck,
} from './auth-page-contract'

export function handleNationalLifeAuthCredentialMessage(
  value: unknown,
  document: Document,
  url: string,
): SubmitCarrierCredentialAck {
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
