import { describe, expect, it } from 'vitest'
import { chatwootConfigFromEnv } from './chatwoot-config'

describe('chatwootConfigFromEnv', () => {
  it('reads the base url and platform token', () => {
    expect(
      chatwootConfigFromEnv({
        CHATWOOT_BASE_URL: 'https://chat.keeprone.com',
        CHATWOOT_PLATFORM_TOKEN: 'tok',
      }),
    ).toEqual({ baseUrl: 'https://chat.keeprone.com', platformToken: 'tok' })
  })

  it('returns null when unconfigured, so the feature is simply absent', () => {
    // Absent configuration must read as "messaging is off", never as a crash on a
    // deployment that has not adopted it yet.
    expect(chatwootConfigFromEnv({})).toBeNull()
  })

  it('refuses a base url that is not https, because the platform token rides on it', () => {
    expect(
      chatwootConfigFromEnv({
        CHATWOOT_BASE_URL: 'http://chat.keeprone.com',
        CHATWOOT_PLATFORM_TOKEN: 'tok',
      }),
    ).toBeNull()
  })

  it('drops a trailing slash so paths do not double up', () => {
    const config = chatwootConfigFromEnv({
      CHATWOOT_BASE_URL: 'https://chat.keeprone.com/',
      CHATWOOT_PLATFORM_TOKEN: 'tok',
    })

    expect(config?.baseUrl).toBe('https://chat.keeprone.com')
  })
})
