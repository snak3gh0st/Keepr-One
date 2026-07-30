import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'

type Cookie = {
  name?: string
  domain?: string
  expires?: number
}

/// Lower bound on how long the stored context stays usable, derived from the
/// cookies that carry an explicit expiry on the carrier's own domains.
///
/// This is deliberately a lower bound and not a guarantee. Most carrier auth
/// cookies are session cookies (`expires` absent or <= 0), which live as long as
/// the browser holds them — and since every job re-seeds a fresh browser from
/// this context, they persist until the *server* invalidates them. Server-side
/// expiry is not observable from cookies at all, so the only honest liveness
/// signal is an authenticated probe.
export function deriveCarrierExpiresAt(
  context: SessionContext,
  allowedDomains: readonly string[],
): Date | null {
  const cookies = (context as { cookies?: Cookie[] }).cookies
  if (!Array.isArray(cookies)) {
    return null
  }

  const suffixes = allowedDomains.map((origin) => {
    try {
      return new URL(origin).hostname
    } catch {
      return origin
    }
  })

  const expiries = cookies
    .filter((cookie) => {
      const domain = (cookie.domain ?? '').replace(/^\./, '')
      if (!domain) {
        return false
      }
      // The cookie domain must *cover* an allowlisted host: a cookie set on
      // `.nationallife.com` applies to `www.nationallife.com` and is typically
      // where the auth cookie lives. Matching the other way round would discard
      // exactly the cookies that matter. `evilnationallife.com` still fails,
      // because the dot boundary is required.
      return suffixes.some((host) => host === domain || host.endsWith(`.${domain}`))
    })
    // Session cookies (no positive expiry) tell us nothing about a deadline.
    .map((cookie) => cookie.expires)
    .filter((expires): expires is number => typeof expires === 'number' && expires > 0)

  if (expiries.length === 0) {
    return null
  }

  // Seconds since epoch, per the CDP cookie representation.
  return new Date(Math.min(...expiries) * 1000)
}

export function countContextCookies(context: SessionContext): number {
  const cookies = (context as { cookies?: unknown[] }).cookies
  return Array.isArray(cookies) ? cookies.length : 0
}

export type StoredSessionRefresh = {
  sessionId: string
  encryptedContext: {
    keyVersion: string
    algorithm: string
    iv: string
    ciphertext: string
    authTag: string
  }
  carrierExpiresAt: Date | null
  refreshedAt: Date
}

export type SessionRefreshStore = {
  updateContext(input: StoredSessionRefresh): Promise<number>
}

/// Persists a freshly captured context over the stored one.
///
/// Without this the cookies captured at login are replayed forever: rotated or
/// sliding-expiry cookies handed back by the carrier are thrown away at the end
/// of every job, so the stored session can only ever get staler.
export async function refreshStoredCarrierSession(
  input: StoredSessionRefresh,
  store: SessionRefreshStore,
): Promise<{ refreshed: boolean }> {
  const updated = await store.updateContext(input)
  return { refreshed: updated === 1 }
}
