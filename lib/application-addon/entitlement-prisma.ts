import 'server-only'

import { prisma } from '@/lib/prisma'
import { isKBotApplicationEnabled } from './config'
import { hasCurrentKBotApplicationEntitlement } from './entitlement'

export type KBotApplicationEntitlement = {
  /** The agent holds a current paid entitlement. Independent of the switch. */
  entitled: boolean
  /** The feature may actually be used: entitled AND globally enabled. */
  available: boolean
  /** Why `available` is false while `entitled` is true. */
  unavailableReason: 'FEATURE_DISABLED' | null
  /**
   * The feature is open at all. Independent of this agent's billing, and the
   * only honest basis for offering the add-on for sale: a closed feature must
   * never be sold, to an entitled agent or anyone else.
   */
  featureEnabled: boolean
  subscriptionId: string | null
  status: string | null
}

export async function getKBotApplicationEntitlement(
  agentId: string,
): Promise<KBotApplicationEntitlement> {
  const subscriptions = await prisma.platformAddonSubscription.findMany({
    where: { agentId, addon: 'K_BOT_APPLICATION' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
  })
  const current = subscriptions.find((subscription) =>
    hasCurrentKBotApplicationEntitlement(subscription),
  )
  const latest = current ?? subscriptions[0] ?? null
  const entitled = current !== undefined
  const enabled = isKBotApplicationEnabled()
  return {
    entitled,
    available: entitled && enabled,
    featureEnabled: enabled,
    // Only report the switch to someone who would otherwise be allowed in;
    // an agent without a subscription is simply not entitled.
    unavailableReason: entitled && !enabled ? 'FEATURE_DISABLED' : null,
    subscriptionId: latest?.id ?? null,
    status: latest?.status ?? null,
  }
}

export async function requireKBotApplicationEntitlement(agentId: string): Promise<void> {
  const entitlement = await getKBotApplicationEntitlement(agentId)
  if (entitlement.unavailableReason === 'FEATURE_DISABLED') {
    throw new Error('K_BOT_APPLICATION_DISABLED')
  }
  if (!entitlement.available) throw new Error('K_BOT_APPLICATION_ADDON_REQUIRED')
}
