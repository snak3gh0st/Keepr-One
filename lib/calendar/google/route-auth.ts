import 'server-only'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function requireCalendarUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) throw new Error('Not authenticated')
  const role = String(session.user.role)
  if (role !== 'AGENT' && role !== 'ADMIN') throw new Error('Forbidden')
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
