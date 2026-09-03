import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_EMAIL_CHANGE_TOKEN_PATTERN,
  adminEmailChangeConfirmationUrl,
  createAdminEmailChangeToken,
  hashAdminEmailChangeToken,
  normalizeLoginEmail,
} from './email-change'

describe('admin email change token', () => {
  it('creates a URL-safe token and exposes only a one-way digest for storage', () => {
    const token = createAdminEmailChangeToken()

    expect(token.rawToken).toMatch(ADMIN_EMAIL_CHANGE_TOKEN_PATTERN)
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(token.tokenHash).not.toContain(token.rawToken)
    expect(hashAdminEmailChangeToken(token.rawToken)).toBe(token.tokenHash)
  })

  it('normalizes addresses and builds a language-specific confirmation URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.keeprone.com/base')
    const rawToken = 'a'.repeat(43)

    expect(normalizeLoginEmail('  Maria@Example.COM ')).toBe('maria@example.com')
    expect(adminEmailChangeConfirmationUrl(rawToken, 'EN')).toBe(
      `https://app.keeprone.com/confirm-email-change?token=${rawToken}&lang=EN`,
    )
    vi.unstubAllEnvs()
  })
})
