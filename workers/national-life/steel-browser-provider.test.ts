import type { NationalLifeEnv } from '../../lib/national-life/env'
import { describe, expect, it } from 'vitest'
import type { SteelSessionDeps } from './steel-session'
import { createSteelBrowserProvider } from './steel-browser-provider'

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
    keepAliveSsoJump: false,
    viewerAppOrigins: ['https://app.keepr.one'],
  }
}

function createFakeDeps() {
  const calls = {
    createInputs: [] as unknown[],
    retrieveIds: [] as string[],
    releaseIds: [] as string[],
    browserDisconnects: 0,
    browserCloses: 0,
    routePatterns: [] as string[],
  }
  const page = { url: () => 'about:blank' }
  const routeHandlers: Array<(route: any, request: any) => Promise<void>> = []
  const context = {
    pages: () => [page],
    newPage: async () => page,
    route: async (pattern: string, handler: (route: any, request: any) => Promise<void>) => {
      calls.routePatterns.push(pattern)
      routeHandlers.push(handler)
    },
  }
  const browser = {
    contexts: () => [context],
    newContext: async () => context,
    close: async () => {
      calls.browserCloses += 1
    },
    _connection: {
      close: () => {
        calls.browserDisconnects += 1
      },
    },
  }
  const deps: SteelSessionDeps = {
    createSteelClient: () => ({
      sessions: {
        create: async (input?: unknown) => {
          calls.createInputs.push(input)
          return {
            id: 'steel-session-1',
            debugUrl: 'https://steel.example/session/1',
            sessionViewerUrl: 'https://steel.example/viewer/1',
            websocketUrl: 'wss://steel.example/devtools/session-1',
            status: 'live' as const,
          }
        },
        retrieve: async (sessionId: string) => {
          calls.retrieveIds.push(sessionId)
          return {
            id: sessionId,
            debugUrl: 'https://steel.example/session/1',
            sessionViewerUrl: 'https://steel.example/viewer/1',
            websocketUrl: 'wss://steel.example/devtools/session-1',
            status: 'live' as const,
          }
        },
        context: async () => ({ cookies: [] }),
        release: async (sessionId: string) => {
          calls.releaseIds.push(sessionId)
          return { success: true }
        },
      },
    }),
    connectBrowser: async () => browser as never,
  }
  return { calls, deps, routeHandlers }
}

describe('Steel browser provider', () => {
  it('creates and attaches with the headful profile and no recording settings', async () => {
    const fake = createFakeDeps()
    const provider = createSteelBrowserProvider(buildEnv(), fake.deps)

    const handle = await provider.create({
      deploymentScope: 'scope-1',
      sessionContext: { cookies: [] },
    })
    const managed = await provider.attach(handle)

    expect(fake.calls.createInputs).toEqual([{
      timeout: 43_200_000,
      headless: false,
      solveCaptcha: false,
      persistProfile: false,
      debugConfig: { interactive: true, systemCursor: true },
      dimensions: { width: 1600, height: 1000 },
      sessionContext: { cookies: [] },
    }])
    expect(fake.calls.retrieveIds).toEqual(['steel-session-1'])
    expect(fake.calls.routePatterns).toEqual(['**/*'])
    expect(managed.viewerTarget).toBe('https://steel.example/viewer/1')
    expect(fake.calls.createInputs[0]).not.toHaveProperty('recording')
  })

  it('guards navigation and disconnects locally without releasing Steel', async () => {
    const fake = createFakeDeps()
    const provider = createSteelBrowserProvider(buildEnv(), fake.deps)
    const managed = await provider.attach(await provider.create({ deploymentScope: 'scope-1' }))
    const [handler] = fake.routeHandlers
    const events = { aborted: [] as string[], continued: 0 }

    await handler(
      { abort: async (reason?: string) => events.aborted.push(reason ?? ''), continue: async () => undefined },
      { isNavigationRequest: () => true, resourceType: () => 'document', url: () => 'https://agent.nationallife.example.evil.test' },
    )
    expect(events.aborted).toEqual(['blockedbyclient'])
    expect(events.continued).toBe(0)

    await managed.disconnect()
    expect(fake.calls.browserDisconnects).toBe(1)
    expect(fake.calls.browserCloses).toBe(0)
    expect(fake.calls.releaseIds).toEqual([])

    await managed.release()
    await managed.release()
    expect(fake.calls.releaseIds).toEqual(['steel-session-1'])
  })
})
