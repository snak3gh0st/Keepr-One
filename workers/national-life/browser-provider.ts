export type BrowserProviderName = 'steel' | 'browserless'

export type InteractiveBrowserHandle = Readonly<{
  provider: BrowserProviderName
  browserSessionId: string
  deploymentScope: string
  viewerTarget: string | null
}>

export type InteractiveBrowserCreateInput = Readonly<{
  deploymentScope: string
  sessionContext?: unknown
}>

export type BrowserProviderHealth = Readonly<{
  provider: BrowserProviderName
  status: 'healthy' | 'unhealthy'
  detail?: string
}>

export type ManagedInteractiveBrowser = Readonly<{
  page: unknown
  context: unknown
  browserSessionId: string
  viewerTarget: string | null
  disconnect(): Promise<void>
  release(): Promise<void>
}>

export type InteractiveBrowserProvider = Readonly<{
  create(input: InteractiveBrowserCreateInput): Promise<InteractiveBrowserHandle>
  attach(handle: InteractiveBrowserHandle): Promise<ManagedInteractiveBrowser>
  health(): Promise<BrowserProviderHealth>
  release(handle: InteractiveBrowserHandle): Promise<void>
}>

export function createScopedInteractiveBrowserProvider(
  provider: InteractiveBrowserProvider,
  deploymentScope: string,
): InteractiveBrowserProvider {
  const releasedHandles = new Set<string>()
  const assertOwned = (handle: InteractiveBrowserHandle) => {
    if (handle.deploymentScope !== deploymentScope) {
      throw new Error('Interactive browser deployment scope was rejected')
    }
  }

  return {
    async create(input) {
      if (input.deploymentScope !== deploymentScope) {
        throw new Error('Interactive browser deployment scope was rejected')
      }
      const handle = await provider.create(input)
      assertOwned(handle)
      return handle
    },
    async attach(handle) {
      assertOwned(handle)
      const managed = await provider.attach(handle)
      let released = false
      return {
        ...managed,
        async release() {
          if (released) return
          released = true
          await managed.release()
        },
      }
    },
    health: () => provider.health(),
    async release(handle) {
      assertOwned(handle)
      if (releasedHandles.has(handle.browserSessionId)) return
      await provider.release(handle)
      releasedHandles.add(handle.browserSessionId)
    },
  }
}
