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
  // Keep the shared portal context intentionally narrow. Besides avoiding an
  // unnecessary scalar fetch on every page, this lets a development database
  // keep rendering while an additive entitlement migration is still pending.
  const agent = await prisma.agent.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      userId: true,
      parentAgentId: true,
      rank: true,
      npn: true,
      status: true,
      createdAt: true,
    },
  })
  if (!agent) throw new Error('Signed-in user has no Agent record')
  return agent
})
