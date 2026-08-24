import { describe, expect, it } from 'vitest'
import { randomChatwootPassword } from './random-password'

describe('randomChatwootPassword', () => {
  // Chatwoot rejects a user whose password lacks any of these classes, and the
  // rejection only shows up against the real server — a mocked client cannot see
  // a remote password policy. Generating hex alone is what made every agent's
  // first visit fail with an empty inbox.
  it('always satisfies the classes Chatwoot demands', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = randomChatwootPassword()

      expect(password.length).toBeGreaterThanOrEqual(16)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[!@#$%^&*]/)
    }
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 100 }, () => randomChatwootPassword()))

    expect(seen.size).toBe(100)
  })
})
