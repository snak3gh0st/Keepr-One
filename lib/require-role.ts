import { requireAgentOnboardingCompleteForUser } from '@/lib/agent-onboarding-gate'
import { requireFounderAccessForUser } from '@/lib/founder-access'
import { getCurrentSession } from '@/lib/i18n/server'

export type Role = 'ADMIN' | 'AGENT' | 'CLIENT'

/**
 * The real authorization boundary for this app.
 *
 * `middleware.ts` only checks for the presence of a session cookie (a coarse,
 * cheap gate to bounce anonymous requests to /login before they hit React).
 * It intentionally does NOT decode/verify the session or check role, because
 * Better Auth's `role` field lives on the `user` row, not in the signed
 * session cookie payload itself — reading it in middleware would require an
 * extra DB round-trip (or a cookie-cache lookup) on every matched request.
 * Every server action and server component that needs role-based access
 * control MUST call `requireRole(...)` itself.
 *
 * Better Auth's admin plugin stores roles as strings. We validate + cast the
 * persisted value to our real `Role` union here instead of trusting a route
 * payload or a client-side role claim.
 */
async function readRequiredRole(
  roles: Role[],
  options: { enforceFounderAccess: boolean; enforceOnboarding: boolean },
) {
  const session = await getCurrentSession()
  if (!session) throw new Error('Not authenticated')

  const banned = (session.user as typeof session.user & { banned?: unknown }).banned
  if (banned === true) {
    throw new Error('Forbidden: account access is suspended')
  }

  const role = session.user.role as unknown as string
  if (!roles.includes(role as Role)) {
    throw new Error('Forbidden: insufficient role')
  }

  // Founder accounts and agents created through accepted agency invitations
  // enter the additive commercial gate. Existing agents with neither marker
  // remain grandfathered, and ADMIN/CLIENT roles never enter this product gate.
  if (options.enforceFounderAccess && role === 'AGENT') {
    await requireFounderAccessForUser(session.user.id)
  }
  if (options.enforceOnboarding && role === 'AGENT') {
    await requireAgentOnboardingCompleteForUser(session.user.id)
  }

  return session
}

export async function requireRole(...roles: Role[]) {
  return readRequiredRole(roles, {
    enforceFounderAccess: true,
    enforceOnboarding: true,
  })
}

/**
 * Restricted escape hatch for the onboarding page and the integration
 * endpoints it invokes. Commercial trial/payment access is still enforced.
 */
export async function requireRoleWithoutOnboarding(...roles: Role[]) {
  return readRequiredRole(roles, {
    enforceFounderAccess: true,
    enforceOnboarding: false,
  })
}

/**
 * Use only for routing users to the correct access-required screen. Product
 * data must continue to call requireRole(), which enforces the commercial gate.
 */
export async function requireRoleWithoutFounderAccess(...roles: Role[]) {
  return readRequiredRole(roles, {
    enforceFounderAccess: false,
    enforceOnboarding: false,
  })
}
