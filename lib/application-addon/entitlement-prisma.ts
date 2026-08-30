import 'server-only'

import { prisma } from '@/lib/prisma'
import { hasCurrentKBotApplicationEntitlement } from './entitlement'

export async function getKBotApplicationEntitlement(agentId: string): Promise<{
  entitled: boolean
  subscriptionId: string | null
  status: string | null
}> {
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
  return {
    entitled: current !== undefined,
    subscriptionId: latest?.id ?? null,
    status: latest?.status ?? null,
  }
}

export async function requireKBotApplicationEntitlement(agentId: string): Promise<void> {
  const entitlement = await getKBotApplicationEntitlement(agentId)
  if (!entitlement.entitled) throw new Error('K_BOT_APPLICATION_ADDON_REQUIRED')
}
