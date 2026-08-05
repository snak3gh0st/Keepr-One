import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNationalLifeLocalConnectorConfig } from './config'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('local connector config', () => {
  it('is disabled by default without requiring connector or Steel settings', () => {
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED', '')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID', '')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL', '')
    vi.stubEnv('STEEL_BASE_URL', '')

    expect(getNationalLifeLocalConnectorConfig()).toEqual({ enabled: false })
  })

  it('enables pilot mode with extension ID only (no Store URL)', () => {
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED', 'true')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID', extensionId)
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL', '')
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.keeprone.com')

    expect(getNationalLifeLocalConnectorConfig()).toEqual({
      enabled: true,
      extensionId,
      installMode: 'pilot',
      storeUrl: null,
      baseUrl: 'https://app.keeprone.com',
    })
  })

  it('returns store mode when an official listing URL is configured', () => {
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED', 'true')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID', extensionId)
    vi.stubEnv(
      'NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL',
      `https://chromewebstore.google.com/detail/keeproneconnect/${extensionId}`,
    )
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.keeprone.com')

    expect(getNationalLifeLocalConnectorConfig()).toEqual({
      enabled: true,
      extensionId,
      installMode: 'store',
      storeUrl: `https://chromewebstore.google.com/detail/keeproneconnect/${extensionId}`,
      baseUrl: 'https://app.keeprone.com',
    })
  })

  it('never enables without a valid extension ID', () => {
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED', 'true')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID', '')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL', '')
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.keeprone.com')

    expect(() => getNationalLifeLocalConnectorConfig()).toThrow(/extension ID/)
  })

  it('rejects a Store URL that is not the official listing for the extension', () => {
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED', 'true')
    vi.stubEnv('NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID', extensionId)
    vi.stubEnv(
      'NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL',
      'https://example.com/detail/connector',
    )
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.keeprone.com')

    expect(() => getNationalLifeLocalConnectorConfig()).toThrow(/Chrome Web Store URL/)
  })
})
