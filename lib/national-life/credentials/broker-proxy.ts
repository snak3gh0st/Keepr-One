import 'server-only'

import { getKBotCredentialWebConfig } from './config'
import { LOCAL_CONNECTOR_SIGNATURE_HEADERS } from '../local-connector/device-signature'
import { readLimitedBody } from '../local-connector/request'

const REQUEST_MAX_BYTES = 2 * 1_024
const RESPONSE_MAX_BYTES = 16 * 1_024
const TIMEOUT_MS = 5_000
const LEASE_PATH = '/api/agent/integrations/national-life/local-connector/credential-leases'
const RESULT_PATH = new RegExp(`^${LEASE_PATH}/[A-Za-z0-9._:-]{1,128}/result$`)
const FORWARDED_HEADERS = [
  'content-type',
  'x-fyntra-connector-version',
  ...Object.values(LOCAL_CONNECTOR_SIGNATURE_HEADERS),
] as const
const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-fyntra-device-error',
] as const

type ProxyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

type ProxyDependencies = Readonly<{
  brokerUrl?: string
  fetch?: ProxyFetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
}>

function unavailable() {
  return Response.json(
    { error: 'CREDENTIAL_BROKER_UNAVAILABLE' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

function invalidRequest() {
  return Response.json(
    { error: 'INVALID_REQUEST' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function readBoundedResponse(response: Response) {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (!Number.isSafeInteger(size) || size < 0 || size > RESPONSE_MAX_BYTES) {
      throw new Error('BROKER_RESPONSE_TOO_LARGE')
    }
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > RESPONSE_MAX_BYTES) {
      await reader.cancel()
      throw new Error('BROKER_RESPONSE_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function forwardedHeaders(source: Headers) {
  const headers = new Headers()
  for (const name of FORWARDED_HEADERS) {
    const value = source.get(name)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

export async function proxyCredentialBrokerRequest(
  request: Request,
  dependencies: ProxyDependencies = {},
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  if (request.method !== 'POST' || (pathname !== LEASE_PATH && !RESULT_PATH.test(pathname))) {
    return invalidRequest()
  }

  let brokerUrl = dependencies.brokerUrl
  if (!brokerUrl) {
    try {
      const config = getKBotCredentialWebConfig()
      if (!config.enabled || !config.brokerUrl) return unavailable()
      brokerUrl = config.brokerUrl
    } catch {
      return unavailable()
    }
  }

  try {
    const body = await readLimitedBody(request, REQUEST_MAX_BYTES)
    const forwardedBody = new Uint8Array(new ArrayBuffer(body.byteLength))
    forwardedBody.set(body)
    const upstream = await (dependencies.fetch ?? globalThis.fetch)(
      `${brokerUrl}${pathname}`,
      {
        method: request.method,
        headers: forwardedHeaders(request.headers),
        body: forwardedBody.buffer,
        redirect: 'error',
        signal: (dependencies.createTimeoutSignal ?? AbortSignal.timeout)(TIMEOUT_MS),
      },
    )
    const responseBody = await readBoundedResponse(upstream)
    const headers = new Headers()
    for (const name of SAFE_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    headers.set('cache-control', 'no-store')
    return new Response(responseBody, { status: upstream.status, headers })
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'BODY_TOO_LARGE') {
      return invalidRequest()
    }
    return unavailable()
  }
}
