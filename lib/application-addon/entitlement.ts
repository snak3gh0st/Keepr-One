export type ApplicationAddonSubscriptionWindow = {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}

export function hasCurrentKBotApplicationEntitlement(
  subscription: ApplicationAddonSubscriptionWindow | null,
  now = new Date(),
): boolean {
  if (!subscription || !['TRIALING', 'ACTIVE'].includes(subscription.status)) return false
  const time = now.getTime()
  if (subscription.currentPeriodStart && subscription.currentPeriodStart.getTime() > time) return false
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd.getTime() <= time) return false
  return true
}
