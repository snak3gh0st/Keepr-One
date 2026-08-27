import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isFounderRegistrationOpen,
  matchFounderAccessCode,
} from './founder-invite-config'

describe('founder invite configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps registration closed without a configured invite', () => {
    vi.stubEnv('FOUNDERS_ACCESS_CODES', '')
    vi.stubEnv('FOUNDERS_ACCESS_CODE', '')

    expect(isFounderRegistrationOpen()).toBe(false)
    expect(matchFounderAccessCode('anything')).toBeNull()
  })

  it('supports comma/newline-separated one-time invite codes', () => {
    vi.stubEnv('FOUNDERS_ACCESS_CODES', 'FOUNDER-A, FOUNDER-B\nFOUNDER-C')
    vi.stubEnv('FOUNDERS_ACCESS_CODE', '')

    expect(isFounderRegistrationOpen()).toBe(true)
    expect(matchFounderAccessCode('FOUNDER-B')).toMatch(/^[a-f0-9]{64}$/)
    expect(matchFounderAccessCode('founder-b')).toBeNull()
  })

  it('keeps the single-code setting as a local/backward-compatible option', () => {
    vi.stubEnv('FOUNDERS_ACCESS_CODES', '')
    vi.stubEnv('FOUNDERS_ACCESS_CODE', 'LOCAL-FOUNDER')

    expect(matchFounderAccessCode('LOCAL-FOUNDER')).toMatch(/^[a-f0-9]{64}$/)
  })
})
