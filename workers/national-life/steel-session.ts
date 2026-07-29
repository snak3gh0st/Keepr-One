import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { Steel } from 'steel-sdk'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS,
  NATIONAL_LIFE_JOB_TIMEOUT_MS,
} from '../../lib/national-life/constants'
import type { NationalLifeEnv } from '../../lib/national-life/env'
import type {
  BrowserSession,
  BrowserSessionContinuation,
  InteractiveBrowserSession,
} from './types'

type RemoteSteelSession = {
  id: string
  debugUrl: string
  sessionViewerUrl?: string
  websocketUrl: string
  status: 'live' | 'released' | 'failed'
}

type ManagedRequest = {
  isNavigationRequest(): boolean
  resourceType(): string
  url(): string
}

type ManagedRoute = {
  abort(reason?: string): Promise<void>
  continue(): Promise<void>
}

type ManagedPage = Pick<Page, 'url'>

type ManagedContext = Pick<BrowserContext, 'pages' | 'newPage' | 'route'>

type ManagedBrowser = Pick<Browser, 'contexts' | 'newContext' | 'close'>

type SteelClient = {
  sessions: {
    create(input?: unknown): Promise<RemoteSteelSession>
    retrieve(sessionId: string): Promise<RemoteSteelSession>
    context(sessionId: string): Promise<SessionContext>
    release(sessionId: string): Promise<unknown>
  }
}

export type SteelSessionDeps = {
  createSteelClient?: (env: NationalLifeEnv) => SteelClient
  connectBrowser?: (websocketUrl: string) => Promise<ManagedBrowser>
  now?: () => Date
}

const DEFAULT_ROUTE_PATTERN = '**/*'
const ABOUT_BLANK_URL = 'about:blank'
const MFA_SESSION_EXPIRED_CODE = 'MFA_SESSION_EXPIRED'

export function assertAllowedNavigation(targetUrl: string, allowedOrigins: readonly string[]): URL {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(targetUrl)
  } catch {
    throw new Error('Navigation URL is invalid')
  }

  const normalizedOrigins = normalizeAllowedOrigins(allowedOrigins)

  if (!normalizedOrigins.has(parsedUrl.origin)) {
    throw new Error('Navigation origin is not allowed')
  }

  return parsedUrl
}

export async function createSteelBrowserSession(
  env: NationalLifeEnv,
  optionsOrDeps?: { sessionContext?: SessionContext } | SteelSessionDeps,
  suppliedDeps?: SteelSessionDeps,
): Promise<BrowserSession> {
  const options = isSteelSessionDeps(optionsOrDeps) ? undefined : optionsOrDeps
  const deps = isSteelSessionDeps(optionsOrDeps) ? optionsOrDeps : suppliedDeps
  const steelClient = createSteelClient(env, deps)
  const remoteSession = await steelClient.sessions.create({
    timeout: NATIONAL_LIFE_JOB_TIMEOUT_MS,
    headless: false,
    solveCaptcha: false,
    ...(options?.sessionContext ? { sessionContext: options.sessionContext } : {}),
  })

  try {
    return await connectManagedSession(remoteSession, steelClient, env, deps)
  } catch (error) {
    await safeReleaseSteelSession(steelClient, remoteSession.id)
    throw error
  }
}

export async function createInteractiveSteelSession(
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<InteractiveBrowserSession> {
  const steelClient = createSteelClient(env, deps)
  const remoteSession = await steelClient.sessions.create({
    timeout: NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS,
    headless: false,
    solveCaptcha: false,
    persistProfile: false,
    debugConfig: { interactive: true, systemCursor: true },
    dimensions: { width: 1600, height: 1000 },
  })

  try {
    const session = await connectManagedSession(remoteSession, steelClient, env, deps)
    return {
      ...session,
      internalDebugUrl: remoteSession.debugUrl,
    }
  } catch (error) {
    await safeReleaseSteelSession(steelClient, remoteSession.id)
    throw error
  }
}

export async function captureSteelSessionContext(
  steelSessionId: string,
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<SessionContext> {
  return createSteelClient(env, deps).sessions.context(steelSessionId)
}

export async function reconnectSteelBrowserSession(
  continuation: BrowserSessionContinuation,
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<BrowserSession> {
  const steelClient = createSteelClient(env, deps)
  const remoteSession = await steelClient.sessions.retrieve(continuation.steelSessionId)

  if (isExpiredContinuation(continuation, deps?.now)) {
    if (remoteSession.status === 'live') {
      await safeReleaseSteelSession(steelClient, remoteSession.id)
    }
    throw createMfaSessionExpiredError()
  }

  if (remoteSession.status !== 'live') {
    throw createMfaSessionExpiredError()
  }

  try {
    return await connectManagedSession(remoteSession, steelClient, env, deps)
  } catch (error) {
    await safeReleaseSteelSession(steelClient, remoteSession.id)
    throw error
  }
}

function createSteelClient(env: NationalLifeEnv, deps?: SteelSessionDeps): SteelClient {
  if (deps?.createSteelClient) {
    return deps.createSteelClient(env)
  }

  return new Steel({
    baseURL: env.steelBaseUrl,
    steelAPIKey: env.steelApiKey,
  })
}

function isSteelSessionDeps(
  value: { sessionContext?: SessionContext } | SteelSessionDeps | undefined,
): value is SteelSessionDeps {
  return Boolean(
    value &&
      ('createSteelClient' in value || 'connectBrowser' in value || 'now' in value),
  )
}

async function connectManagedSession(
  remoteSession: RemoteSteelSession,
  steelClient: SteelClient,
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<BrowserSession> {
  const connectBrowser = deps?.connectBrowser ?? defaultConnectBrowser
  let browser: ManagedBrowser | undefined

  try {
    browser = await connectBrowser(remoteSession.websocketUrl)

    const context = await getOrCreateContext(browser)
    await installNavigationGuard(context, env.portalOrigins)

    const page = await getOrCreatePage(context)
    const currentUrl = page.url()

    if (currentUrl && currentUrl !== ABOUT_BLANK_URL) {
      assertAllowedNavigation(currentUrl, env.portalOrigins)
    }

    return createBrowserSession(remoteSession, browser, context, page, steelClient)
  } catch (error) {
    if (browser) {
      await safeCloseBrowser(browser)
    }
    throw error
  }
}

async function getOrCreateContext(browser: ManagedBrowser): Promise<ManagedContext> {
  const [existingContext] = browser.contexts()
  return existingContext ?? browser.newContext()
}

async function getOrCreatePage(context: ManagedContext): Promise<ManagedPage> {
  const [existingPage] = context.pages()
  return existingPage ?? context.newPage()
}

async function installNavigationGuard(context: ManagedContext, allowedOrigins: readonly string[]) {
  await context.route(DEFAULT_ROUTE_PATTERN, async (route: ManagedRoute, request: ManagedRequest) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') {
      try {
        assertAllowedNavigation(request.url(), allowedOrigins)
      } catch {
        await route.abort('blockedbyclient')
        return
      }
    }

    await route.continue()
  })
}

function createBrowserSession(
  remoteSession: RemoteSteelSession,
  browser: ManagedBrowser,
  context: ManagedContext,
  page: ManagedPage,
  steelClient: SteelClient,
): BrowserSession {
  let browserDisconnected = false
  let steelReleased = false
  let browserDisconnectInFlight: Promise<void> | undefined
  let steelReleaseInFlight: Promise<void> | undefined

  const disconnect = async () => {
    if (browserDisconnected) {
      return
    }

    if (!browserDisconnectInFlight) {
      browserDisconnectInFlight = (async () => {
        try {
          await browser.close()
          browserDisconnected = true
        } finally {
          browserDisconnectInFlight = undefined
        }
      })()
    }

    await browserDisconnectInFlight
  }

  const releaseSteel = async () => {
    if (steelReleased) {
      return
    }

    if (!steelReleaseInFlight) {
      steelReleaseInFlight = (async () => {
        try {
          await steelClient.sessions.release(remoteSession.id)
          steelReleased = true
        } finally {
          steelReleaseInFlight = undefined
        }
      })()
    }

    await steelReleaseInFlight
  }

  const close = async () => {
    let disconnectError: unknown

    if (!browserDisconnected) {
      try {
        await disconnect()
      } catch (error) {
        disconnectError = error
      }
    }

    let releaseError: unknown

    try {
      await releaseSteel()
    } catch (error) {
      releaseError = error
    }

    if (disconnectError) {
      throw disconnectError
    }

    if (releaseError) {
      throw releaseError
    }
  }

  return {
    browser: browser as Browser,
    context: context as BrowserContext,
    page: page as Page,
    steelSessionId: remoteSession.id,
    debugUrl: remoteSession.debugUrl,
    close,
    disconnect,
  }
}

function normalizeAllowedOrigins(allowedOrigins: readonly string[]) {
  return new Set(
    allowedOrigins.map((allowedOrigin) => {
      const parsedOrigin = new URL(allowedOrigin)
      return parsedOrigin.origin
    }),
  )
}

function isExpiredContinuation(
  continuation: BrowserSessionContinuation,
  nowFactory?: () => Date,
): boolean {
  if (typeof continuation.expiresAt !== 'string') {
    return true
  }

  const expiresAt = new Date(continuation.expiresAt)

  if (Number.isNaN(expiresAt.getTime())) {
    return true
  }

  const now = nowFactory ? nowFactory() : new Date()
  return expiresAt.getTime() <= now.getTime()
}

function createMfaSessionExpiredError() {
  const error = new Error(MFA_SESSION_EXPIRED_CODE)
  ;(error as Error & { code: string }).code = MFA_SESSION_EXPIRED_CODE
  return error
}

async function safeCloseBrowser(browser: ManagedBrowser) {
  try {
    await browser.close()
  } catch {
    // Best-effort cleanup only.
  }
}

async function safeReleaseSteelSession(steelClient: SteelClient, sessionId: string) {
  try {
    await steelClient.sessions.release(sessionId)
  } catch {
    // Best-effort cleanup only.
  }
}

export async function defaultConnectBrowser(websocketUrl: string) {
  // Steel proxies the private Chrome DevTools socket. Chromium rejects the
  // service-name host header at that inner endpoint, so retain localhost
  // while keeping the proxy itself reachable only on the private network.
  return chromium.connectOverCDP(websocketUrl, {
    headers: { Host: 'localhost' },
  })
}
