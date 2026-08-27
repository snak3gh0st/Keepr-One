import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowLocalEmailChangeWithoutVerification } from './email-change-config'

afterEach(() => {
  vi.unstubAllEnvs()
})
describe('local email-change preview', () => {
  it('requires both development mode and an explicit opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ALLOW_LOCAL_EMAIL_CHANGE_WITHOUT_VERIFICATION', 'true')

    expect(allowLocalEmailChangeWithoutVerification()).toBe(true)
  })

  it('can never bypass verification in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LOCAL_EMAIL_CHANGE_WITHOUT_VERIFICATION', 'true')

    expect(allowLocalEmailChangeWithoutVerification()).toBe(false)
  })
})
