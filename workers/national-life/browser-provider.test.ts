import { describe, expect, it } from 'vitest'
import {
  createScopedInteractiveBrowserProvider,
  type BrowserProviderHealth,
  type InteractiveBrowserHandle,
  type InteractiveBrowserProvider,
  type ManagedInteractiveBrowser,
} from './browser-provider'

function createFakeProvider() {
  const calls = { create: 0, attach: 0, health: 0, release: 0 }
  const managedRelease = { calls: 0 }
  const handle: InteractiveBrowserHandle = {
    provider: 'steel',
    browserSessionId: 'session-1',
    deploymentScope: 'scope-1',
    viewerTarget: null,
  }
  const managed: ManagedInteractiveBrowser = {
    page: { url: () => 'about:blank' },
    context: {},
    browserSessionId: handle.browserSessionId,
    viewerTarget: handle.viewerTarget,
    disconnect: async () => undefined,
    release: async () => {
      managedRelease.calls += 1
    },
  }
  const health: BrowserProviderHealth = { provider: 'steel', status: 'healthy' }
  const provider: InteractiveBrowserProvider = {
    async create() {
      calls.create += 1
      return handle
    },
    async attach(input) {
      calls.attach += 1
      expect(input).toEqual(handle)
      return managed
    },
    async health() {
      calls.health += 1
      return health
    },
    async release(input) {
      calls.release += 1
      expect(input).toEqual(handle)
    },
  }
  return { calls, handle, managed, managedRelease, health, provider }
}

describe('interactive browser provider contract', () => {
  it('creates and attaches a managed browser without exposing vendor types', async () => {
    const fake = createFakeProvider()
    const provider = createScopedInteractiveBrowserProvider(fake.provider, 'scope-1', 'steel')

    const handle = await provider.create({ deploymentScope: 'scope-1' })
    const managed = await provider.attach(handle)

    expect(handle).toEqual(fake.handle)
    expect(managed).toMatchObject({
      page: fake.managed.page,
      context: fake.managed.context,
      browserSessionId: fake.managed.browserSessionId,
      viewerTarget: fake.managed.viewerTarget,
    })
    expect(fake.calls).toMatchObject({ create: 1, attach: 1 })
  })

  it('disconnects without releasing and releases exactly once', async () => {
    const fake = createFakeProvider()
    const provider = createScopedInteractiveBrowserProvider(fake.provider, 'scope-1', 'steel')
    const managed = await provider.attach(await provider.create({ deploymentScope: 'scope-1' }))

    await managed.disconnect()
    expect(fake.calls.release).toBe(0)
    await managed.release()
    await managed.release()

    expect(fake.managedRelease.calls).toBe(1)
    await provider.release(fake.handle)
    await provider.release(fake.handle)
    expect(fake.calls.release).toBe(1)
  })

  it('reports health and rejects handles owned by another deployment scope', async () => {
    const fake = createFakeProvider()
    const provider = createScopedInteractiveBrowserProvider(fake.provider, 'scope-1', 'steel')

    await expect(provider.health()).resolves.toEqual(fake.health)
    await expect(provider.attach({ ...fake.handle, deploymentScope: 'scope-2' })).rejects.toThrow(
      'deployment scope',
    )
    await expect(provider.release({ ...fake.handle, deploymentScope: 'scope-2' })).rejects.toThrow(
      'deployment scope',
    )
  })

  it('rejects handles from another provider even when the scope matches', async () => {
    const fake = createFakeProvider()
    const provider = createScopedInteractiveBrowserProvider(fake.provider, 'scope-1', 'steel')
    const foreignHandle = { ...fake.handle, provider: 'browserless' as const }

    await expect(provider.attach(foreignHandle)).rejects.toThrow('provider')
    await expect(provider.release(foreignHandle)).rejects.toThrow('provider')
    expect(fake.calls.attach).toBe(0)
    expect(fake.calls.release).toBe(0)
  })

  it('deduplicates concurrent release calls for one handle', async () => {
    const fake = createFakeProvider()
    let finishRelease!: () => void
    fake.provider = {
      ...fake.provider,
      release: async () => {
        fake.calls.release += 1
        await new Promise<void>((resolve) => {
          finishRelease = resolve
        })
      },
    }
    const provider = createScopedInteractiveBrowserProvider(fake.provider, 'scope-1', 'steel')

    const first = provider.release(fake.handle)
    const second = provider.release(fake.handle)
    await Promise.resolve()
    expect(fake.calls.release).toBe(1)
    finishRelease()
    await Promise.all([first, second])
  })
})
