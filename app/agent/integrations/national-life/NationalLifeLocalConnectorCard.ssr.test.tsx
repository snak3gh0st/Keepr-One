// @vitest-environment node

import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'

describe('NationalLifeLocalConnectorCard SSR', () => {
  it('renders without reading browser globals on the server', () => {
    expect(() =>
      renderToString(
        <NationalLifeLocalConnectorCard
          extensionId="abcdefghijklmnopabcdefghijklmnop"
          storeUrl="https://chromewebstore.google.com/detail/keeproneconnect/abcdefghijklmnopabcdefghijklmnop"
          baseUrl="https://app.keeprone.com"
        />,
      ),
    ).not.toThrow()
  })
})
