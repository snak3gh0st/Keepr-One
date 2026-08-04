import { describe, expect, it } from 'vitest'
import { createBrowserProvider } from './browser-provider-factory'
import type { InteractiveBrowserProvider } from './browser-provider'

const provider = {} as InteractiveBrowserProvider

describe('browser provider factory', () => {
  it.each(['steel', 'browserless'] as const)('selects configured %s', (name) => {
    expect(createBrowserProvider({ provider: name, steel: provider, browserless: provider })).toBe(provider)
  })

  it('rejects unknown providers instead of falling back to Steel', () => {
    expect(() => createBrowserProvider({ provider: 'unknown', steel: provider, browserless: provider })).toThrow(
      'Unknown browser provider',
    )
  })
})
