import type { NationalLifeEnv } from '../../lib/national-life/env'
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
        sessionContext: input.sessionContext,
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

  return createScopedInteractiveBrowserProvider(provider, env.sessionScopeId)
}
