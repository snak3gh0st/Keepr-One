import type { InteractiveBrowserProvider } from './browser-provider'

export function createBrowserProvider(input: {
  provider: string
  steel: InteractiveBrowserProvider
  browserless: InteractiveBrowserProvider
}): InteractiveBrowserProvider {
  if (input.provider === 'steel') return input.steel
  if (input.provider === 'browserless') return input.browserless
  throw new Error(`Unknown browser provider: ${input.provider}`)
}
