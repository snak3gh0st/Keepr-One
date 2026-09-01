import { requireAllowedBaseUrl } from './constants'
import { CONNECTOR_VERSION_HEADER, readExtensionVersion } from './contract'
import { readPrivateKey } from './key-store'

const encoder = new TextEncoder()

export function canonicalMessage(input: {
  method: string
  pathname: string
  jti: string
  timestamp: string
  bodyHash: string
}): string {
  return [
    input.method.toUpperCase(),
    input.pathname,
    input.jti,
    input.timestamp,
    input.bodyHash,
  ].join('\n')
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function base64Url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function sha256Bytes(value: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer))
}

export async function signCanonicalMessage(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(message),
  )
  return base64Url(signature)
}

export class SignedRequestError extends Error {
  constructor(
    readonly code:
      | 'DEVICE_KEY_UNAVAILABLE'
      | 'DEVICE_REVOKED'
      | 'FOUNDER_ACCESS_REQUIRED'
      | 'DEVICE_REQUEST_REJECTED'
      | 'DEVICE_REQUEST_FAILED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'STAGE_INCOMPLETE'
      | 'STAGE_TRUNCATED'
      | 'PATH_NOT_ALLOWED'
      | 'CLIENT_TOO_OLD'
      | 'CONNECTOR_PAUSED'
      | 'RUN_START_RATE_LIMITED'
      | 'FORESIGHT_TERM_PDF_INVALID'
      | 'FORESIGHT_TERM_PREMIUM_MISSING'
      | 'FORESIGHT_TERM_PREMIUM_MISMATCH'
      | 'DEVICE_ENCRYPTION_KEY_CONFLICT',
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(code)
  }
}

export function termReconciliationFailure(response: Response): Promise<
  'FORESIGHT_TERM_PDF_INVALID' | 'FORESIGHT_TERM_PREMIUM_MISSING' | 'FORESIGHT_TERM_PREMIUM_MISMATCH' | null
> {
  if (response.status !== 422) return Promise.resolve(null)
  return response.clone().json()
    .then((payload: unknown) => {
      const code = payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error?: unknown }).error
        : null
      return code === 'FORESIGHT_TERM_PDF_INVALID' ||
        code === 'FORESIGHT_TERM_PREMIUM_MISSING' ||
        code === 'FORESIGHT_TERM_PREMIUM_MISMATCH'
        ? code
        : null
    })
    .catch(() => null)
}

function isTransientSignedRequestFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return error instanceof SignedRequestError &&
    error.code === 'DEVICE_REQUEST_FAILED' &&
    (error.status === undefined || error.status >= 500)
}

export async function retryIdempotentSignedRequest<T>(input: {
  request: () => Promise<T>
  wait?: (milliseconds: number) => Promise<unknown>
  delaysMs?: readonly number[]
}): Promise<T> {
  const delays = input.delaysMs ?? [750, 2_500]
  const wait = input.wait ?? ((milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)))

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.request()
    } catch (error) {
      const delay = delays[attempt]
      if (delay === undefined || !isTransientSignedRequestFailure(error)) throw error
      await wait(delay)
    }
  }
}

/// Um 401 sozinho não prova nada sobre o pareamento: o servidor devolve o mesmo
/// status para relógio fora da janela da assinatura e para soluço de banco no
/// registro de replay. Só a afirmação explícita de que o dispositivo não existe
/// mais autoriza o chamador a apagar a chave privada — sem isso, um desvio de
/// horário, que persiste depois de reparear, viraria um laço.
export function classifyFailedResponse(
  status: number,
  headers: Pick<Headers, 'get'>,
):
  | 'DEVICE_REVOKED'
  | 'FOUNDER_ACCESS_REQUIRED'
  | 'DEVICE_REQUEST_REJECTED'
  | 'DEVICE_REQUEST_FAILED'
  | 'CLIENT_TOO_OLD'
  | 'CONNECTOR_PAUSED'
  | 'RUN_START_RATE_LIMITED' {
  // 426 e 503-pausado precisam de código próprio ou caem em DEVICE_REQUEST_FAILED,
  // que está na classe "portal" e diz ao agente "espere um minuto e tente de novo".
  // Para versão velha isso é falso e vira laço: tentar de novo nunca resolve, só
  // atualizar resolve. Para pausa, "um minuto" é uma promessa que ninguém fez.
  if (status === 426) return 'CLIENT_TOO_OLD'
  if (status === 429) return 'RUN_START_RATE_LIMITED'
  if (status === 503 && headers.get('x-fyntra-connector-state') === 'PAUSED') {
    return 'CONNECTOR_PAUSED'
  }
  if (status !== 401) return 'DEVICE_REQUEST_FAILED'
  const deviceError = headers.get('x-fyntra-device-error')
  if (deviceError === 'DEVICE_REVOKED') return 'DEVICE_REVOKED'
  if (deviceError === 'FOUNDER_ACCESS_REQUIRED') return 'FOUNDER_ACCESS_REQUIRED'
  return 'DEVICE_REQUEST_REJECTED'
}

export async function signedJsonRequest<T>(input: {
  baseUrl: string
  deviceId: string
  method: 'POST' | 'PUT'
  pathname: string
  body: unknown
  idempotencyKey?: string
}): Promise<T> {
  const baseUrl = requireAllowedBaseUrl(input.baseUrl)
  if (!input.pathname.startsWith('/api/agent/integrations/national-life/local-connector/')) {
    throw new SignedRequestError('PATH_NOT_ALLOWED')
  }
  const key = await readPrivateKey()
  if (!key) throw new SignedRequestError('DEVICE_KEY_UNAVAILABLE')
  const body = JSON.stringify(input.body)
  const bodyHash = await sha256(body)
  const timestamp = new Date().toISOString()
  const jti = crypto.randomUUID()
  const canonical = canonicalMessage({
    method: input.method,
    pathname: input.pathname,
    jti,
    timestamp,
    bodyHash,
  })
  const signature = await signCanonicalMessage(key, canonical)
  const headers = new Headers({
    'content-type': 'application/json',
    'x-fyntra-device-id': input.deviceId,
    'x-fyntra-jti': jti,
    'x-fyntra-timestamp': timestamp,
    'x-fyntra-body-sha256': bodyHash,
    'x-fyntra-signature': signature,
  })
  if (input.idempotencyKey) headers.set('x-idempotency-key', input.idempotencyKey)
  // Auto-declarada e fora da mensagem canônica de propósito: assiná-la sugeriria
  // que ela é confiável, e ela não é — o servidor trata como sinal, não prova.
  const extensionVersion = readExtensionVersion()
  if (extensionVersion) headers.set(CONNECTOR_VERSION_HEADER, extensionVersion)

  const response = await fetch(`${baseUrl}${input.pathname}`, {
    method: input.method,
    headers,
    body,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  if (response.status === 409) {
    let conflictCode: unknown
    try {
      const payload = (await response.clone().json()) as { error?: unknown }
      conflictCode = payload.error
    } catch {
      // Some 409 responses have no JSON body. Preserve the old idempotency
      // fallback for those responses.
    }
    if (conflictCode === 'STAGE_INCOMPLETE' || conflictCode === 'STAGE_TRUNCATED') {
      throw new SignedRequestError(conflictCode)
    }
    if (conflictCode === 'DEVICE_ENCRYPTION_KEY_CONFLICT') {
      throw new SignedRequestError('DEVICE_ENCRYPTION_KEY_CONFLICT')
    }
    throw new SignedRequestError('IDEMPOTENCY_CONFLICT')
  }
  if (!response.ok) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
    const reconciliationCode = await termReconciliationFailure(response)
    throw new SignedRequestError(
      reconciliationCode ?? classifyFailedResponse(response.status, response.headers),
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function signedBinaryRequest<T>(input: {
  baseUrl: string
  deviceId: string
  method: 'PUT'
  pathname: string
  body: Uint8Array
  contentType?: 'application/octet-stream' | 'application/pdf'
}): Promise<T> {
  const baseUrl = requireAllowedBaseUrl(input.baseUrl)
  if (!input.pathname.startsWith('/api/agent/integrations/national-life/local-connector/')) {
    throw new SignedRequestError('PATH_NOT_ALLOWED')
  }
  const key = await readPrivateKey()
  if (!key) throw new SignedRequestError('DEVICE_KEY_UNAVAILABLE')
  const bodyHash = await sha256Bytes(input.body)
  const timestamp = new Date().toISOString()
  const jti = crypto.randomUUID()
  const canonical = canonicalMessage({ method: input.method, pathname: input.pathname, jti, timestamp, bodyHash })
  const signature = await signCanonicalMessage(key, canonical)
  const headers = new Headers({
    'content-type': input.contentType ?? 'application/octet-stream',
    'x-fyntra-device-id': input.deviceId,
    'x-fyntra-jti': jti,
    'x-fyntra-timestamp': timestamp,
    'x-fyntra-body-sha256': bodyHash,
    'x-fyntra-signature': signature,
  })
  const extensionVersion = readExtensionVersion()
  if (extensionVersion) headers.set(CONNECTOR_VERSION_HEADER, extensionVersion)
  const response = await fetch(`${baseUrl}${input.pathname}`, {
    method: input.method,
    headers,
    body: input.body as BodyInit,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) {
    throw new SignedRequestError(classifyFailedResponse(response.status, response.headers), response.status)
  }
  return (await response.json()) as T
}
