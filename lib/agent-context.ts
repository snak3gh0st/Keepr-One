import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'

// Agent-portal pages are for AGENT and ADMIN users only — never CLIENT.
// We deliberately allow ADMIN here (rather than restricting to AGENT alone)
// so admins can view/QA the agent portal directly. If an ADMIN account has
// no corresponding Agent row, the lookup below still throws a clear error
// rather than silently exposing agent data — it never bypasses the
// "must have an Agent record" invariant, it only widens *who* is allowed to
// even attempt to load one.
export const getCurrentAgent = cache(async function getCurrentAgent() {
  const session = await requireRole('ADMIN', 'AGENT')
  const agent = await prisma.agent.findUnique({ where: { userId: session.user.id } })
  if (!agent) throw new Error('Signed-in user has no Agent record')
  return agent
})
