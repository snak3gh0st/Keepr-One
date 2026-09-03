import 'server-only'
import { auth } from '@/lib/auth'

/**
 * Uses Better Auth's own internal adapter so a security event clears the
 * database inventory, every Redis token and the active-sessions index with the
 * exact same semantics as the official admin revocation endpoint.
 */
export async function revokeAllAuthSessions(userId: string): Promise<void> {
  const context = await auth.$context
  await context.internalAdapter.deleteUserSessions(userId)
}
