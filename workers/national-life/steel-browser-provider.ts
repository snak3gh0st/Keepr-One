import type { NationalLifeEnv } from '../../lib/national-life/env'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  attachSteelInteractiveHandle,
  createSteelInteractiveHandle,
  releaseSteelInteractiveHandle,
  type SteelSessionDeps,
} from './steel-session'
import {
  createScopedInteractiveBrowserProvider,
  type InteractiveBrowserProvider,
} from './browser-provider'

export function createSteelBrowserProvider(
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): InteractiveBrowserProvider {
  const provider: InteractiveBrowserProvider = {
    async create(input) {
      return createSteelInteractiveHandle(env, {
        ...deps,
        deploymentScope: input.deploymentScope,
        sessionContext: parseSessionContext(input.sessionContext),
      })
    },
    async attach(handle) {
      const session = await attachSteelInteractiveHandle(handle, env, deps)
      const sessionWithRelease = session as typeof session & { release(): Promise<void> }
      return {
        page: session.page,
        context: session.context,
        browserSessionId: handle.browserSessionId,
        viewerTarget: handle.viewerTarget,
        disconnect: session.disconnect,
        release: sessionWithRelease.release,
      }
    },
    async health() {
      return { provider: 'steel', status: 'healthy' }
    },
    release: (handle) => releaseSteelInteractiveHandle(handle, env, deps),
  }

  return createScopedInteractiveBrowserProvider(provider, env.sessionScopeId, 'steel')
}

function parseSessionContext(value: unknown): SessionContext | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new Error('Steel session context was rejected')
  }

  if (
    value.cookies !== undefined &&
    (!Array.isArray(value.cookies) ||
      value.cookies.some(
        (cookie) =>
          !isRecord(cookie) ||
          typeof cookie.name !== 'string' ||
          typeof cookie.value !== 'string',
      ))
  ) {
    throw new Error('Steel session context was rejected')
  }

  return value as SessionContext
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
