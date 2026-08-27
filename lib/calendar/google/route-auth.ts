import 'server-only'

import { requireRole, requireRoleWithoutOnboarding } from '@/lib/require-role'

export async function requireCalendarUser(options?: { allowOnboarding?: boolean }) {
  const session = options?.allowOnboarding
    ? await requireRoleWithoutOnboarding('AGENT', 'ADMIN')
    : await requireRole('AGENT', 'ADMIN')
  return {
    userId: session.user.id,
    // Bind state to Better Auth's stable server-side session identity; the raw
    // signed cookie token never leaves the auth library or enters our tables.
    sessionId: session.session.id,
  }
}
export function safeCalendarReturnTo(value: string | null, fallback = '/agent/calendar') {
  return value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value.slice(0, 500)
    : fallback
}
