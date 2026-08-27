import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// This middleware is a COARSE gate only: it checks whether a session cookie
// is present so anonymous requests bounce to /login before hitting React at
// all. It deliberately does NOT decode the cookie or check `role`, for two
// reasons: (1) `getSessionCookie` reads Better Auth's signed cookie
// presence/validity cheaply, without a DB round-trip, but the `role` field
// lives on the `user` row and isn't embedded in the cookie payload itself
// (Better Auth's cookie-cache feature can embed selected session data, but
// we haven't enabled it here, and doing so just to read `role` in
// middleware trades a DB round-trip in `requireRole()` for a cache
// invalidation/staleness problem instead); (2) even if role were readable
// here cheaply, per-role authorization for what a given page/action is
// allowed to read or mutate is still finer-grained than route prefixes
// (e.g. "AGENT can read own downline, not just any /agent/* route").
//
// The REAL authorization boundary is `requireRole()` (lib/require-role.ts),
// called from every server action and server component under /admin, /agent,
// and /client. Do not rely on this middleware for anything beyond bouncing
// logged-out users to /login.
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/agent/:path*', '/client/:path*', '/onboarding/:path*'],
}
