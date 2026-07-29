import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import { afterEach, describe, expect, it, vi } from 'vitest'

const connectOverCDP = vi.hoisted(() => vi.fn())

vi.mock('playwright-core', () => ({
  chromium: { connectOverCDP },
}))

import {
  assertAllowedNavigation,
  captureSteelSessionContext,
  createInteractiveSteelSession,
  createSteelBrowserSession,
  defaultConnectBrowser,
  reconnectSteelBrowserSession,
  type SteelSessionDeps,
} from './steel-session'

function buildEnv(): NationalLifeEnv {
  return {
    steelBaseUrl: 'https://steel.example',
    steelApiKey: 'steel-key',
    portalOrigins: ['https://agent.nationallife.example'],
    portalLoginUrl: 'https://agent.nationallife.example/login',
    sessionScopeId: 'scope-1',
    sessionKeyVersion: 'v1',
    sessionKeys: { v1: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    viewerSigningKey: Buffer.alloc(32, 2),
    viewerPublicOrigin: 'https://viewer.keepr.one',
    viewerBindHost: '127.0.0.1',
    viewerPort: 3010,
    runtimeWorkerId: 'worker-1',
    interactiveLoginEnabled: true,
    interactiveLoginAgentIds: new Set(['agent-1']),
    interactiveLoginAllAgents: false,
    appOrigin: 'https://app.keepr.one',
  }
}

type FakeRemoteSession = {
  id: string
  debugUrl: string
  websocketUrl: string
  status: 'live' | 'released' | 'failed'
}

type FakeRequest = {
  isNavigationRequest(): boolean
  resourceType(): string
  url(): string
}

type FakeRoute = {
  abort(reason?: string): Promise<void>
  continue(): Promise<void>
}

type RouteHandler = (route: FakeRoute, request: FakeRequest) => Promise<void>

function createFakeSessionDeps(options?: {
  createSession?: FakeRemoteSession
  retrieveSession?: FakeRemoteSession
  pageUrl?: string
  now?: string
  browserCloseFailures?: number
  releaseFailures?: number
  context?: SessionContext
}) {
  const createSession =
    options?.createSession ??
    ({
      id: 'steel-session-1',
      debugUrl: 'https://steel.example/session/1',
      websocketUrl: 'wss://steel.example/devtools/session-1',
      status: 'live',
    } satisfies FakeRemoteSession)
  const retrieveSession =
    options?.retrieveSession ??
    ({
      id: createSession.id,
      debugUrl: createSession.debugUrl,
      websocketUrl: createSession.websocketUrl,
      status: createSession.status,
    } satisfies FakeRemoteSession)

  const routeHandlers: RouteHandler[] = []
  const routePatterns: string[] = []
  let browserCloseCount = 0
  let releaseCount = 0
  let createCalls = 0
  const createInputs: unknown[] = []
  let remainingBrowserCloseFailures = options?.browserCloseFailures ?? 0
  let remainingReleaseFailures = options?.releaseFailures ?? 0
  const retrieveCalls: string[] = []
  const releaseCalls: string[] = []
  const contextCalls: string[] = []

  const page = {
    url: () => options?.pageUrl ?? 'about:blank',
  }

  const context = {
    pages: () => [page],
    newPage: async () => page,
    route: async (pattern: string, handler: RouteHandler) => {
      routePatterns.push(pattern)
      routeHandlers.push(handler)
    },
  }

  const browser = {
    contexts: () => [context],
    newContext: async () => context,
    close: async () => {
      browserCloseCount += 1

      if (remainingBrowserCloseFailures > 0) {
        remainingBrowserCloseFailures -= 1
        throw new Error('browser.close failed')
      }
    },
  }

  const deps: SteelSessionDeps = {
    createSteelClient: () => ({
      sessions: {
        create: async (input?: unknown) => {
          createCalls += 1
          createInputs.push(input)
          return createSession
        },
        context: async (sessionId: string) => {
          contextCalls.push(sessionId)
          return options?.context ?? { cookies: [] }
        },
        retrieve: async (sessionId: string) => {
          retrieveCalls.push(sessionId)
          return retrieveSession
        },
        release: async (sessionId: string) => {
          releaseCount += 1
          releaseCalls.push(sessionId)

          if (remainingReleaseFailures > 0) {
            remainingReleaseFailures -= 1
            throw new Error('steel release failed')
          }

          return { success: true }
        },
      },
    }),
    connectBrowser: async () => browser as never,
    now: () => new Date(options?.now ?? '2026-07-27T12:00:00.000Z'),
  }

  return {
    deps,
    routeHandlers,
    routePatterns,
    getBrowserCloseCount: () => browserCloseCount,
    getReleaseCount: () => releaseCount,
    getCreateCalls: () => createCalls,
    createInputs,
    contextCalls,
    retrieveCalls,
    releaseCalls,
  }
}

async function invokeRouteHandler(handler: RouteHandler, requestUrl: string) {
  const events = { aborted: [] as string[], continued: 0 }

  const route: FakeRoute = {
    abort: async (reason) => {
      events.aborted.push(reason ?? '')
    },
    continue: async () => {
      events.continued += 1
    },
  }

  const request: FakeRequest = {
    isNavigationRequest: () => true,
    resourceType: () => 'document',
    url: () => requestUrl,
  }

  await handler(route, request)
  return events
}

describe('National Life Steel session boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    connectOverCDP.mockReset()
  })

  it('attaches directly through Steel\'s private API websocket proxy', async () => {
    connectOverCDP.mockImplementationOnce(async (endpoint: string) => ({
      endpoint,
      contexts: () => [],
    }))
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('CDP discovery must not bypass the Steel API proxy')
    }))

    const browser = await defaultConnectBrowser('ws://national-life-steel:3000/') as unknown as {
      endpoint: string
    }

    expect(browser.endpoint).toBe('ws://national-life-steel:3000/')
  })

  it('creates an interactive real Steel session with the exact safe options', async () => {
    const fake = createFakeSessionDeps()

    const session = await createInteractiveSteelSession(buildEnv(), fake.deps)

    expect(fake.createInputs).toEqual([{
      timeout: 600000,
      headless: false,
      solveCaptcha: false,
      persistProfile: false,
      debugConfig: { interactive: true, systemCursor: true },
      dimensions: { width: 1280, height: 800 },
    }])
    expect(session.internalDebugUrl).toBe('https://steel.example/session/1')
    await session.close()
  })

  it('restores a worker session with the exact captured session context', async () => {
    const fake = createFakeSessionDeps()
    const sessionContext: SessionContext = {
      cookies: [{ name: 'nlg-session', value: 'secret', domain: '.nationallife.example' }],
    }

    const session = await createSteelBrowserSession(
      buildEnv(),
      { sessionContext },
      fake.deps,
    )

    expect(fake.createInputs).toEqual([{
      timeout: 300000,
      headless: false,
      solveCaptcha: false,
      sessionContext,
    }])
    await session.close()
  })

  it('captures context for the exact Steel session id', async () => {
    const context: SessionContext = { cookies: [] }
    const fake = createFakeSessionDeps({ context })

    await expect(
      captureSteelSessionContext('steel-session-9', buildEnv(), fake.deps),
    ).resolves.toEqual(context)
    expect(fake.contextCalls).toEqual(['steel-session-9'])
  })

  it('allows exact allowed origins and rejects lookalike hosts', () => {
    expect(() =>
      assertAllowedNavigation('https://agent.nationallife.example/cases', [
        'https://agent.nationallife.example',
      ]),
    ).not.toThrow()

    expect(() =>
      assertAllowedNavigation('https://agent.nationallife.example.evil.test/', [
        'https://agent.nationallife.example',
      ]),
    ).toThrow('Navigation origin is not allowed')
  })

  it('closes the Playwright browser and releases the Steel session exactly once', async () => {
    const fake = createFakeSessionDeps()

    const session = await createSteelBrowserSession(buildEnv(), fake.deps)

    await session.close()
    await session.close()

    expect(fake.getCreateCalls()).toBe(1)
    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(1)
    expect(fake.releaseCalls).toEqual(['steel-session-1'])
  })

  it('disconnects without releasing Steel and only releases on the eventual close', async () => {
    const fake = createFakeSessionDeps()

    const session = await createSteelBrowserSession(buildEnv(), fake.deps)

    await session.disconnect()

    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(0)

    await session.close()
    await session.close()

    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(1)
    expect(fake.releaseCalls).toEqual(['steel-session-1'])
  })

  it('retries browser cleanup after a transient close failure without double-releasing Steel', async () => {
    const fake = createFakeSessionDeps({ browserCloseFailures: 1 })

    const session = await createSteelBrowserSession(buildEnv(), fake.deps)

    await expect(session.close()).rejects.toThrow('browser.close failed')

    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(1)
    expect(fake.releaseCalls).toEqual(['steel-session-1'])

    await session.close()

    expect(fake.getBrowserCloseCount()).toBe(2)
    expect(fake.getReleaseCount()).toBe(1)
    expect(fake.releaseCalls).toEqual(['steel-session-1'])
  })

  it('retries Steel release after a transient release failure without reclosing the browser', async () => {
    const fake = createFakeSessionDeps({ releaseFailures: 1 })

    const session = await createSteelBrowserSession(buildEnv(), fake.deps)

    await expect(session.close()).rejects.toThrow('steel release failed')

    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(1)
    expect(fake.releaseCalls).toEqual(['steel-session-1'])

    await session.close()

    expect(fake.getBrowserCloseCount()).toBe(1)
    expect(fake.getReleaseCount()).toBe(2)
    expect(fake.releaseCalls).toEqual(['steel-session-1', 'steel-session-1'])
  })

  it('installs the navigation guard when creating a session', async () => {
    const fake = createFakeSessionDeps()

    const session = await createSteelBrowserSession(buildEnv(), fake.deps)

    expect(fake.routePatterns).toEqual(['**/*'])

    const [handler] = fake.routeHandlers
    expect(handler).toBeTypeOf('function')

    await expect(invokeRouteHandler(handler, 'https://agent.nationallife.example/cases')).resolves.toEqual(
      { aborted: [], continued: 1 },
    )
    await expect(
      invokeRouteHandler(handler, 'https://agent.nationallife.example.evil.test/cases'),
    ).resolves.toEqual({ aborted: ['blockedbyclient'], continued: 0 })

    await session.close()
  })

  it('reconnects a live session, reinstalls the guard, and uses the existing Steel session id', async () => {
    const fake = createFakeSessionDeps({
      retrieveSession: {
        id: 'steel-session-2',
        debugUrl: 'https://steel.example/session/2',
        websocketUrl: 'wss://steel.example/devtools/session-2',
        status: 'live',
      },
    })

    const session = await reconnectSteelBrowserSession(
      {
        steelSessionId: 'steel-session-2',
        debugUrl: 'https://steel.example/session/2',
        expiresAt: '2026-07-27T12:05:00.000Z',
      },
      buildEnv(),
      fake.deps,
    )

    expect(fake.retrieveCalls).toEqual(['steel-session-2'])
    expect(fake.routePatterns).toEqual(['**/*'])
    expect(session.steelSessionId).toBe('steel-session-2')

    const [handler] = fake.routeHandlers
    await expect(
      invokeRouteHandler(handler, 'https://agent.nationallife.example.evil.test/cases'),
    ).resolves.toEqual({ aborted: ['blockedbyclient'], continued: 0 })

    await session.close()
    expect(fake.releaseCalls).toEqual(['steel-session-2'])
  })

  it('fails expired reconnects with MFA_SESSION_EXPIRED and releases the preserved Steel session', async () => {
    const fake = createFakeSessionDeps({
      retrieveSession: {
        id: 'steel-session-3',
        debugUrl: 'https://steel.example/session/3',
        websocketUrl: 'wss://steel.example/devtools/session-3',
        status: 'live',
      },
      now: '2026-07-27T12:06:00.000Z',
    })

    await expect(
      reconnectSteelBrowserSession(
        {
          steelSessionId: 'steel-session-3',
          debugUrl: 'https://steel.example/session/3',
          expiresAt: '2026-07-27T12:05:00.000Z',
        },
        buildEnv(),
        fake.deps,
      ),
    ).rejects.toThrow('MFA_SESSION_EXPIRED')

    expect(fake.retrieveCalls).toEqual(['steel-session-3'])
    expect(fake.getBrowserCloseCount()).toBe(0)
    expect(fake.releaseCalls).toEqual(['steel-session-3'])
  })

  it('rejects reconnects without a valid continuation deadline and releases the preserved Steel session', async () => {
    const cases = [
      {
        continuation: {
          steelSessionId: 'steel-session-4',
          debugUrl: 'https://steel.example/session/4',
        } as never,
        sessionId: 'steel-session-4',
      },
      {
        continuation: {
          steelSessionId: 'steel-session-5',
          debugUrl: 'https://steel.example/session/5',
          expiresAt: 'not-a-date',
        },
        sessionId: 'steel-session-5',
      },
    ]

    for (const testCase of cases) {
      const fake = createFakeSessionDeps({
        retrieveSession: {
          id: testCase.sessionId,
          debugUrl: `https://steel.example/session/${testCase.sessionId.at(-1)}`,
          websocketUrl: `wss://steel.example/devtools/${testCase.sessionId}`,
          status: 'live',
        },
      })

      await expect(
        reconnectSteelBrowserSession(testCase.continuation, buildEnv(), fake.deps),
      ).rejects.toThrow('MFA_SESSION_EXPIRED')

      expect(fake.retrieveCalls).toEqual([testCase.sessionId])
      expect(fake.getBrowserCloseCount()).toBe(0)
      expect(fake.releaseCalls).toEqual([testCase.sessionId])
    }
  })
})
