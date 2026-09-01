import 'server-only'

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { prisma } from '@/lib/prisma'
import { getKBotCredentialBrokerConfig } from '@/lib/national-life/credentials/config'
import {
  createCredentialLeaseService,
  createPrismaCredentialLeasePersistence,
  CredentialLeaseError,
} from '@/lib/national-life/credentials/lease-service'
import { createVaultTransitDecryptClient } from '@/lib/national-life/credentials/vault-transit'
import {
  LocalConnectorSignatureError,
  verifyLocalConnectorDeviceRequest,
} from '@/lib/national-life/local-connector/device-signature'
import {
  LocalConnectorRequestError,
  parseJsonBody,
  readLimitedBody,
} from '@/lib/national-life/local-connector/request'

const REQUEST_MAX_BYTES = 2 * 1_024
const LEASE_PATH = '/api/agent/integrations/national-life/local-connector/credential-leases'
const RESULT_PATH = new RegExp(`^${LEASE_PATH}/([A-Za-z0-9._:-]{1,128})/result$`)
const NO_STORE = { 'Cache-Control': 'no-store' }

type DeviceIdentity = Readonly<{ agentId: string; deviceId: string; jti: string }>
type BrokerDependencies = Readonly<{
  verifyDevice(input: {
    method: string
    pathname: string
    headers: Headers
    body: Uint8Array
  }): Promise<DeviceIdentity>
  issueCredentialLease(input: {
    agentId: string
    deviceId: string
    request: unknown
  }): Promise<unknown>
  recordCredentialLeaseOutcome(input: {
    agentId: string
    deviceId: string
    leaseId: string
    result: unknown
  }): Promise<unknown>
}>

function json(body: Record<string, unknown>, status: number, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

function leaseErrorResponse(error: CredentialLeaseError) {
  switch (error.code) {
    case 'CREDENTIAL_PAGE_NOT_APPROVED':
      return json({ error: 'INVALID_REQUEST' }, 400)
    case 'CREDENTIAL_RATE_LIMITED':
      return json(
        { error: error.code },
        429,
        error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {},
      )
    case 'CREDENTIAL_LIMIT_UNAVAILABLE':
    case 'CREDENTIAL_DELIVERY_FAILED':
    case 'CREDENTIAL_FEATURE_DISABLED':
      return json({ error: 'CREDENTIAL_BROKER_UNAVAILABLE' }, 503)
    default:
      return json({ error: error.code }, 409)
  }
}

export function createKBotCredentialBrokerHandler(deps: BrokerDependencies) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname
    if (request.method === 'GET' && pathname === '/health') {
      return json({ ok: true }, 200)
    }
    const resultMatch = RESULT_PATH.exec(pathname)
    if (request.method !== 'POST' || (pathname !== LEASE_PATH && !resultMatch)) {
      return json({ error: 'NOT_FOUND' }, 404)
    }

    try {
      const body = await readLimitedBody(request, REQUEST_MAX_BYTES)
      const device = await deps.verifyDevice({
        method: request.method,
        pathname,
        headers: request.headers,
        body,
      })
      const payload = parseJsonBody(body)
      const result = resultMatch
        ? await deps.recordCredentialLeaseOutcome({
            agentId: device.agentId,
            deviceId: device.deviceId,
            leaseId: resultMatch[1]!,
            result: payload,
          })
        : await deps.issueCredentialLease({
            agentId: device.agentId,
            deviceId: device.deviceId,
            request: payload,
          })
      return Response.json(result, { status: 200, headers: NO_STORE })
    } catch (error) {
      if (error instanceof LocalConnectorSignatureError) {
        return json(
          { error: 'DEVICE_REQUEST_REJECTED' },
          401,
          { 'x-fyntra-device-error': error.code },
        )
      }
      if (error instanceof CredentialLeaseError) return leaseErrorResponse(error)
      if (error instanceof LocalConnectorRequestError) return json({ error: 'INVALID_REQUEST' }, 400)
      return json({ error: 'CREDENTIAL_BROKER_UNAVAILABLE' }, 503)
    }
  }
}

export function createKBotCredentialBrokerDependencies(): BrokerDependencies {
  const config = getKBotCredentialBrokerConfig()
  const decryptPort = config.enabled && config.vault
    ? createVaultTransitDecryptClient(config.vault)
    : {
        async decrypt(): Promise<never> {
          throw new CredentialLeaseError('CREDENTIAL_FEATURE_DISABLED')
        },
      }
  const service = createCredentialLeaseService({
    persistence: createPrismaCredentialLeasePersistence(prisma),
    decryptPort,
    rollout: config,
  })
  return {
    verifyDevice(input) {
      return verifyLocalConnectorDeviceRequest(prisma, input)
    },
    issueCredentialLease(input) {
      return service.issueCredentialLease(input)
    },
    recordCredentialLeaseOutcome(input) {
      return service.recordCredentialLeaseOutcome(input)
    },
  }
}

async function nodeRequest(
  incoming: IncomingMessage,
  response: ServerResponse,
  port: number,
): Promise<Request | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of incoming) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > REQUEST_MAX_BYTES) {
      response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: 'INVALID_REQUEST' }))
      return null
    }
    chunks.push(bytes)
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item))
    else if (value !== undefined) headers.set(name, value)
  }
  return new Request(`http://127.0.0.1:${port}${incoming.url ?? '/'}`, {
    method: incoming.method ?? 'GET',
    headers,
    body: total > 0 ? Buffer.concat(chunks) : undefined,
  })
}

export function createKBotCredentialBrokerServer(input: {
  port: number
  handler?: ReturnType<typeof createKBotCredentialBrokerHandler>
}) {
  const handler = input.handler ?? createKBotCredentialBrokerHandler(
    createKBotCredentialBrokerDependencies(),
  )
  return createServer(async (incoming, outgoing) => {
    try {
      const request = await nodeRequest(incoming, outgoing, input.port)
      if (!request) return
      const response = await handler(request)
      outgoing.statusCode = response.status
      response.headers.forEach((value, name) => outgoing.setHeader(name, value))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      outgoing.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      outgoing.end(JSON.stringify({ error: 'CREDENTIAL_BROKER_UNAVAILABLE' }))
    }
  })
}

export async function runKBotCredentialBroker() {
  const config = getKBotCredentialBrokerConfig()
  const port = config.port ?? 3020
  const server = createKBotCredentialBrokerServer({ port })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', resolve)
  })
  return server
}
