import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agencyInvitationUrl,
  createAgencyInvitationToken,
  hashAgencyInvitationToken,
  isLocalBillingSimulationEnabled,
  isValidAgencyInvitationToken,
} from './agency-invitations'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('agency invitation tokens', () => {
  it('creates a 256-bit base64url token and stores a separate SHA-256 digest', () => {
    const first = createAgencyInvitationToken()
    const second = createAgencyInvitationToken()

    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.tokenHash).toBe(hashAgencyInvitationToken(first.rawToken))
    expect(first.tokenHash).not.toContain(first.rawToken)
    expect(second.rawToken).not.toBe(first.rawToken)
  })

  it('builds the public link from the configured application origin only', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/some/base?ignored=1')
    const { rawToken } = createAgencyInvitationToken()

    expect(agencyInvitationUrl(rawToken)).toBe(
      `https://app.example.com/convites/agencia/${rawToken}`,
    )
    expect(() => agencyInvitationUrl('../unsafe')).toThrow('Invalid agency invitation token')
    expect(isValidAgencyInvitationToken(rawToken)).toBe(true)
  })
})

describe('local billing simulation boundary', () => {
  it('requires an explicit true value outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ALLOW_LOCAL_BILLING_SIMULATION', 'true')
    expect(isLocalBillingSimulationEnabled()).toBe(true)

    vi.stubEnv('ALLOW_LOCAL_BILLING_SIMULATION', 'false')
    expect(isLocalBillingSimulationEnabled()).toBe(false)
  })

  it('always fails closed in production even if the flag was copied as true', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LOCAL_BILLING_SIMULATION', 'true')
    expect(isLocalBillingSimulationEnabled()).toBe(false)
  })
})
