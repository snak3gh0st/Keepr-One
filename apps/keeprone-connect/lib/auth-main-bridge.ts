import {
  activateNationalLifeLoginInMainWorld,
  NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL,
} from './auth-page-contract'

type AuthSubmitBridgeInput = Readonly<{
  data: unknown
  origin: string
  sourceIsWindow: boolean
  document: Document
  url: string
}>

function exactSubmitSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  const keys = Object.keys(message).sort()
  return keys.length === 2 && keys[0] === 'channel' && keys[1] === 'type' &&
    message.channel === NATIONAL_LIFE_AUTH_SUBMIT_CHANNEL && message.type === 'SUBMIT_LOGIN'
}

export function handleNationalLifeAuthSubmitBridgeMessage(
  input: AuthSubmitBridgeInput,
): boolean {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return false
  }
  if (
    !input.sourceIsWindow ||
    input.origin !== url.origin ||
    !exactSubmitSignal(input.data)
  ) return false
  return activateNationalLifeLoginInMainWorld(input.document, input.url)
}
