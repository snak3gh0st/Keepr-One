import { describe, expect, it, vi } from 'vitest'
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import {
  countContextCookies,
  deriveCarrierExpiresAt,
  refreshStoredCarrierSession,
} from './session-refresh'

const PORTAL_DOMAINS = ['https://www.nationallife.com', 'https://nlg-prod.auth0.com']

function context(cookies: unknown[]): SessionContext {
  return { cookies } as unknown as SessionContext
}

describe('National Life session refresh', () => {
  it('takes the earliest explicit expiry on a carrier domain', () => {
    const expiresAt = deriveCarrierExpiresAt(
      context([
        { name: 'a', domain: 'www.nationallife.com', expires: 2_000_000_000 },
        { name: 'b', domain: '.nationallife.com', expires: 1_900_000_000 },
        { name: 'c', domain: 'nlg-prod.auth0.com', expires: 2_100_000_000 },
      ]),
      PORTAL_DOMAINS,
    )

    expect(expiresAt).toEqual(new Date(1_900_000_000 * 1000))
  })

  it('ignores cookies from unrelated domains, so analytics cannot shorten it', () => {
    const expiresAt = deriveCarrierExpiresAt(
      context([
        { name: 'ga', domain: '.google-analytics.com', expires: 1_000 },
        { name: 'auth', domain: 'www.nationallife.com', expires: 2_000_000_000 },
      ]),
      PORTAL_DOMAINS,
    )

    expect(expiresAt).toEqual(new Date(2_000_000_000 * 1000))
  })

  it('returns null when every carrier cookie is a session cookie', () => {
    // The common case: no deadline is knowable from cookies alone.
    expect(
      deriveCarrierExpiresAt(
        context([
          { name: 'a', domain: 'www.nationallife.com' },
          { name: 'b', domain: 'www.nationallife.com', expires: -1 },
          { name: 'c', domain: 'www.nationallife.com', expires: 0 },
        ]),
        PORTAL_DOMAINS,
      ),
    ).toBeNull()
  })

  it('returns null for a context with no cookies at all', () => {
    expect(deriveCarrierExpiresAt(context([]), PORTAL_DOMAINS)).toBeNull()
    expect(deriveCarrierExpiresAt({} as SessionContext, PORTAL_DOMAINS)).toBeNull()
  })

  it('does not treat a lookalike domain as the carrier', () => {
    expect(
      deriveCarrierExpiresAt(
        context([{ name: 'x', domain: 'evilnationallife.com', expires: 2_000_000_000 }]),
        PORTAL_DOMAINS,
      ),
    ).toBeNull()
  })

  it('counts cookies defensively', () => {
    expect(countContextCookies(context([{}, {}]))).toBe(2)
    expect(countContextCookies({} as SessionContext)).toBe(0)
  })

  it('reports whether the stored row was actually replaced', async () => {
    const payload = {
      sessionId: 'session-1',
      encryptedContext: {
        keyVersion: 'v1',
        algorithm: 'aes-256-gcm',
        iv: 'iv',
        ciphertext: 'ct',
        authTag: 'tag',
      },
      carrierExpiresAt: null,
      refreshedAt: new Date('2026-07-30T02:00:00.000Z'),
    }

    await expect(
      refreshStoredCarrierSession(payload, { updateContext: vi.fn(async () => 1) }),
    ).resolves.toEqual({ refreshed: true })

    // A scope or status mismatch must not look like success.
    await expect(
      refreshStoredCarrierSession(payload, { updateContext: vi.fn(async () => 0) }),
    ).resolves.toEqual({ refreshed: false })
  })
})
