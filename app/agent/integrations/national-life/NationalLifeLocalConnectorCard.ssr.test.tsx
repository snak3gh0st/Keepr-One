// @vitest-environment node

import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))

import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'

describe('NationalLifeLocalConnectorCard SSR', () => {
  it('renders without reading browser globals on the server', () => {
    expect(() =>
      renderToString(
        <NationalLifeLocalConnectorCard
          extensionId="abcdefghijklmnopabcdefghijklmnop"
          storeUrl={null}
          installMode="pilot"
          baseUrl="https://app.keeprone.com"
        />,
      ),
    ).not.toThrow()
  })
})
