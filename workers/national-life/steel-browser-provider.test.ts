import { describe, expect, it } from 'vitest'
import { createSteelBrowserProvider } from './steel-browser-provider'

describe('Steel browser provider', () => {
  it('exposes the provider-neutral Steel adapter', () => {
    expect(createSteelBrowserProvider).toBeTypeOf('function')
  })
})
