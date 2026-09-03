import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  normalizePlatformModules,
  type PlatformModuleName,
} from '@/lib/platform-modules'
import { requireRole } from '@/lib/require-role'

export class PlatformModuleAccessError extends Error {
  readonly code = 'PLATFORM_MODULE_DISABLED'

  constructor(readonly module: PlatformModuleName) {
    super(`Forbidden: platform module ${module} required`)
    this.name = 'PlatformModuleAccessError'
  }
}

/**
 * Authoritative Server Action boundary for an agent product surface.
 *
 * Path-based checks are useful navigation protection, but a Server Action can
 * be replayed against another pathname. Every module-owned action must call
 * this guard before reading or mutating product data. Administrators retain
 * the access already granted by the action itself; legacy and current agency-
 * invitation accounts remain unrestricted by AdminProvisionedAccess.
 */
export async function requireAgentModule(module: PlatformModuleName) {
  const session = await requireRole('ADMIN', 'AGENT')
  if (session.user.role === 'ADMIN') return session

  const agent = await prisma.agent.findUnique({
    where: { userId: session.user.id },
    select: {
      adminProvisionedAccess: {
        select: { modules: true },
      },
      agencyInvitationsAccepted: {
        where: { status: 'ACCEPTED', isCurrentCommercial: true },
        take: 1,
        select: { id: true },
      },
    },
  })
  if (!agent) throw new Error('Signed-in user has no Agent record')

  const managedAccess = agent.agencyInvitationsAccepted.length
    ? null
    : agent.adminProvisionedAccess
  if (
    managedAccess
    && !normalizePlatformModules(managedAccess.modules).includes(module)
  ) {
    throw new PlatformModuleAccessError(module)
  }

  return session
}
