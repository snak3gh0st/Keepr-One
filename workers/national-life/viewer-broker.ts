import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import httpProxy from 'http-proxy'
import type {
  AttemptRuntime,
  EncryptedBrowserSecret,
} from '../../lib/national-life/browser-context-crypto'
import {
  createViewerSessionToken,
  hashViewerNonce,
  verifyViewerBootstrapToken,
  verifyViewerSessionToken,
} from '../../lib/national-life/viewer-token'

const VIEWER_COOKIE = '__Host-keepr_nlg_viewer'
const VIEWER_SESSION_TTL_MS = 5 * 60_000
const INTERACTIVE_STATES = new Set(['AWAITING_LOGIN', 'AWAITING_MFA'])

export type NationalLifeViewerBrokerDeps = {
  env: {
    signingKey: Buffer
    appOrigin: string
  }
  now: () => Date
  store: {
    consumeBootstrapNonce(input: {
      attemptId: string
      agentId: string
      nonceHash: string
      now: Date
    }): Promise<boolean>
    getOwnedAttemptRuntime(input: {
      attemptId: string
      agentId: string
      now: Date
    }): Promise<{
      state: string
      expiresAt: Date
      runtime?: AttemptRuntime
      encryptedRuntime?: EncryptedBrowserSecret
    } | null>
  }
  decryptRuntime?: (
    encrypted: EncryptedBrowserSecret,
    ownership: { attemptId: string; agentId: string },
  ) => AttemptRuntime
}

export function createNationalLifeViewerBroker(
  deps: NationalLifeViewerBrokerDeps,
) {
  const appOrigin = validateAppOrigin(deps.env.appOrigin)
  const proxy = httpProxy.createProxyServer({
    ws: true,
    changeOrigin: true,
  })

  proxy.on('proxyRes', (proxyResponse) => {
    delete proxyResponse.headers['x-frame-options']
    proxyResponse.headers['content-security-policy'] = buildCsp(appOrigin)
    proxyResponse.headers['referrer-policy'] = 'no-referrer'
    proxyResponse.headers['cache-control'] = 'no-store'
    proxyResponse.headers['permissions-policy'] = permissionsPolicy
  })

  const server = createServer(async (request, response) => {
    setPrivateHeaders(response)
    const requestUrl = new URL(request.url ?? '/', 'http://viewer.internal')

    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      response.statusCode = 200
      response.end('ok')
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/bootstrap') {
      await handleBootstrap(requestUrl, response, deps)
      return
    }

    if (
      request.method === 'GET' &&
      (requestUrl.pathname === '/viewer' ||
        requestUrl.pathname.startsWith('/viewer/'))
    ) {
      const target = await resolveViewerTarget(request, deps)
      if (!target) {
        unauthorized(response)
        return
      }
      proxy.web(
        request,
        response,
        {
          target: target.toString(),
          ws: true,
          changeOrigin: true,
          ignorePath: true,
        },
        () => {
          if (!response.headersSent) {
            response.statusCode = 502
            response.end('Viewer unavailable')
          }
        },
      )
      return
    }

    response.statusCode = 404
    response.end('Not found')
  })

  server.on('upgrade', async (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://viewer.internal')
    if (
      requestUrl.pathname !== '/viewer' &&
      !requestUrl.pathname.startsWith('/viewer/')
    ) {
      rejectUpgrade(socket, 404)
      return
    }

    const target = await resolveViewerTarget(request, deps)
    if (!target) {
      rejectUpgrade(socket, 401)
      return
    }

    proxy.ws(
      request,
      socket,
      head,
      {
        target: target.toString(),
        ws: true,
        changeOrigin: true,
        ignorePath: true,
      },
      () => rejectUpgrade(socket, 502),
    )
  })

  return server
}

async function handleBootstrap(
  requestUrl: URL,
  response: ServerResponse,
  deps: NationalLifeViewerBrokerDeps,
) {
  const ticket = requestUrl.searchParams.get('ticket')
  if (!ticket) {
    unauthorized(response)
    return
  }

  try {
    const now = deps.now()
    const payload = verifyViewerBootstrapToken(
      ticket,
      deps.env.signingKey,
      now,
    )
    const consumed = await deps.store.consumeBootstrapNonce({
      attemptId: payload.attemptId,
      agentId: payload.agentId,
      nonceHash: hashViewerNonce(payload.nonce),
      now,
    })
    if (!consumed) {
      unauthorized(response)
      return
    }

    const expiresAt = new Date(now.getTime() + VIEWER_SESSION_TTL_MS)
    const sessionToken = createViewerSessionToken(
      {
        attemptId: payload.attemptId,
        agentId: payload.agentId,
        expiresAt: expiresAt.toISOString(),
      },
      deps.env.signingKey,
    )
    response.statusCode = 302
    response.setHeader(
      'Set-Cookie',
      `${VIEWER_COOKIE}=${sessionToken}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(VIEWER_SESSION_TTL_MS / 1000)}`,
    )
    response.setHeader('Location', '/viewer/')
    response.end()
  } catch {
    unauthorized(response)
  }
}

async function resolveViewerTarget(
  request: IncomingMessage,
  deps: NationalLifeViewerBrokerDeps,
) {
  const token = readCookie(request.headers.cookie, VIEWER_COOKIE)
  if (!token) {
    return null
  }

  try {
    const now = deps.now()
    const payload = verifyViewerSessionToken(
      token,
      deps.env.signingKey,
      now,
    )
    const attempt = await deps.store.getOwnedAttemptRuntime({
      attemptId: payload.attemptId,
      agentId: payload.agentId,
      now,
    })
    if (
      !attempt ||
      !INTERACTIVE_STATES.has(attempt.state) ||
      attempt.expiresAt <= now
    ) {
      return null
    }

    const runtime =
      attempt.runtime ??
      (attempt.encryptedRuntime && deps.decryptRuntime
        ? deps.decryptRuntime(attempt.encryptedRuntime, {
            attemptId: payload.attemptId,
            agentId: payload.agentId,
          })
        : null)
    if (!runtime || new Date(runtime.expiresAt) <= now) {
      return null
    }

    const target = new URL(runtime.debugUrl)
    target.searchParams.set('interactive', 'true')
    target.searchParams.set('showControls', 'false')
    return target
  } catch {
    return null
  }
}

function readCookie(rawCookie: string | undefined, name: string) {
  if (!rawCookie) {
    return null
  }
  for (const part of rawCookie.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=')
    if (cookieName === name) {
      return valueParts.join('=') || null
    }
  }
  return null
}

function validateAppOrigin(value: string) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error('National Life viewer app origin is invalid')
  }
  return parsed.origin
}

const permissionsPolicy =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()'

function buildCsp(appOrigin: string) {
  return `default-src 'self'; frame-ancestors ${appOrigin}; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss:; font-src 'self' data:`
}

function setPrivateHeaders(response: ServerResponse) {
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Permissions-Policy', permissionsPolicy)
}

function unauthorized(response: ServerResponse) {
  response.statusCode = 401
  response.end('Unauthorized')
}

function rejectUpgrade(socket: Socket, status: 401 | 404 | 502) {
  if (socket.destroyed) {
    return
  }
  const reason =
    status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Bad Gateway'
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n`,
  )
}
