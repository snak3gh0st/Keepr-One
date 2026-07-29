import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createViewerBootstrapToken,
  hashViewerNonce,
} from '../../lib/national-life/viewer-token'
import {
  createNationalLifeViewerBroker,
  type NationalLifeViewerBrokerDeps,
} from './viewer-broker'

const signingKey = Buffer.alloc(32, 8)
const now = new Date('2026-07-28T12:00:00.000Z')
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  servers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  return `http://127.0.0.1:${address.port}`
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()))
}

async function createFixture() {
  const upstreamRequests: string[] = []
  const upstream = createServer((request, response) => {
    upstreamRequests.push(request.url ?? '')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', "default-src *")
    response.setHeader('Referrer-Policy', 'unsafe-url')
    response.end('steel-viewer')
  })
  upstream.on('upgrade', (request, socket) => {
    upstreamRequests.push(`UPGRADE:${request.url ?? ''}`)
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    )
    socket.end()
  })
  const upstreamOrigin = await listen(upstream)

  let state: 'AWAITING_LOGIN' | 'AWAITING_MFA' | 'CANCELLED' = 'AWAITING_LOGIN'
  let nonceHash: string | null = null
  const deps: NationalLifeViewerBrokerDeps = {
    env: {
      signingKey,
      appOrigin: 'https://app.keepr.one',
    },
    now: () => now,
    store: {
      async consumeBootstrapNonce(input) {
        if (
          input.agentId !== 'agent-1' ||
          input.attemptId !== 'attempt-1' ||
          input.nonceHash !== nonceHash
        ) {
          return false
        }
        nonceHash = null
        return true
      },
      async getOwnedAttemptRuntime(input) {
        if (
          input.agentId !== 'agent-1' ||
          input.attemptId !== 'attempt-1' ||
          state === 'CANCELLED'
        ) {
          return null
        }
        return {
          state,
          expiresAt: new Date('2026-07-28T12:10:00.000Z'),
          runtime: {
            steelSessionId: 'steel-session-1',
            debugUrl: `${upstreamOrigin}/debug`,
            expiresAt: '2026-07-28T12:10:00.000Z',
          },
        }
      },
    },
  }
  const broker = createNationalLifeViewerBroker(deps)
  const brokerOrigin = await listen(broker)

  function issue(overrides?: { agentId?: string; attemptId?: string; expiresAt?: string }) {
    const issued = createViewerBootstrapToken(
      {
        agentId: overrides?.agentId ?? 'agent-1',
        attemptId: overrides?.attemptId ?? 'attempt-1',
        expiresAt: overrides?.expiresAt ?? '2026-07-28T12:01:00.000Z',
      },
      signingKey,
      () => Buffer.alloc(32, 6),
    )
    nonceHash = issued.nonceHash
    return issued.token
  }

  return {
    broker,
    brokerOrigin,
    upstreamRequests,
    issue,
    setState(value: typeof state) {
      state = value
    },
    setNonce(value: string) {
      nonceHash = hashViewerNonce(value)
    },
  }
}

async function bootstrap(origin: string, ticket: string) {
  return fetch(`${origin}/bootstrap?ticket=${encodeURIComponent(ticket)}`, {
    redirect: 'manual',
  })
}

function viewerCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('missing viewer cookie')
  return setCookie.split(';', 1)[0]
}

describe('National Life signed viewer broker', () => {
  it('rejects invalid, expired, replayed, wrong-agent, and wrong-attempt tickets', async () => {
    const fixture = await createFixture()
    expect((await bootstrap(fixture.brokerOrigin, 'invalid-token')).status).toBe(401)
    expect((await bootstrap(
      fixture.brokerOrigin,
      fixture.issue({ expiresAt: '2026-07-28T11:59:00.000Z' }),
    )).status).toBe(401)
    expect((await bootstrap(
      fixture.brokerOrigin,
      fixture.issue({ agentId: 'agent-2' }),
    )).status).toBe(401)
    expect((await bootstrap(
      fixture.brokerOrigin,
      fixture.issue({ attemptId: 'attempt-2' }),
    )).status).toBe(401)

    const valid = fixture.issue()
    expect((await bootstrap(fixture.brokerOrigin, valid)).status).toBe(302)
    expect((await bootstrap(fixture.brokerOrigin, valid)).status).toBe(401)
  })

  it('atomically consumes bootstrap and sets hardened cookie and response headers', async () => {
    const fixture = await createFixture()
    const response = await bootstrap(fixture.brokerOrigin, fixture.issue())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/viewer/')
    expect(response.headers.get('set-cookie')).toContain(
      '__Host-keepr_nlg_viewer=',
    )
    expect(response.headers.get('set-cookie')).toContain(
      'Secure; HttpOnly; SameSite=Strict; Path=/',
    )
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects missing and expired viewer cookies', async () => {
    const fixture = await createFixture()
    expect((await fetch(`${fixture.brokerOrigin}/viewer/`)).status).toBe(401)
  })

  it('proxies authenticated HTTP only to the owned attempt debug URL', async () => {
    const fixture = await createFixture()
    const bootstrapResponse = await bootstrap(fixture.brokerOrigin, fixture.issue())
    const response = await fetch(
      `${fixture.brokerOrigin}/viewer/?target=https://evil.test`,
      { headers: { Cookie: viewerCookie(bootstrapResponse) } },
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('steel-viewer')
    expect(fixture.upstreamRequests).toEqual([
      '/debug?interactive=true&showControls=false',
    ])
  })

  it('proxies authenticated upgrade only to the owned attempt debug URL', async () => {
    const fixture = await createFixture()
    const bootstrapResponse = await bootstrap(fixture.brokerOrigin, fixture.issue())
    const response = await rawUpgrade(
      fixture.broker,
      viewerCookie(bootstrapResponse),
      '/viewer/?target=https://evil.test',
    )
    expect(response).toContain('101 Switching Protocols')
    expect(fixture.upstreamRequests).toEqual([
      'UPGRADE:/debug?interactive=true&showControls=false',
    ])
  })

  it('invalidates viewer access immediately for terminal attempts', async () => {
    const fixture = await createFixture()
    const bootstrapResponse = await bootstrap(fixture.brokerOrigin, fixture.issue())
    fixture.setState('CANCELLED')
    expect((await fetch(`${fixture.brokerOrigin}/viewer/`, {
      headers: { Cookie: viewerCookie(bootstrapResponse) },
    })).status).toBe(401)
  })

  it('replaces unsafe upstream framing, CSP, and referrer headers', async () => {
    const fixture = await createFixture()
    const bootstrapResponse = await bootstrap(fixture.brokerOrigin, fixture.issue())
    const response = await fetch(`${fixture.brokerOrigin}/viewer/`, {
      headers: { Cookie: viewerCookie(bootstrapResponse) },
    })

    expect(response.headers.get('x-frame-options')).toBeNull()
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain(
      "frame-ancestors https://app.keepr.one",
    )
    expect(response.headers.get('content-security-policy')).not.toContain('*')
  })
})

function rawUpgrade(server: Server, cookie: string, path: string) {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server not listening')

  return new Promise<string>((resolve, reject) => {
    const socket = connect(address.port, '127.0.0.1')
    let response = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    socket.on('data', (chunk) => {
      response += chunk
    })
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}
