import 'server-only'

import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from './client'
import { assertKBotApplicationPrice, getKBotApplicationCatalog } from './application-addon-catalog'
import { toPlatformSubscriptionStatus } from './platform-subscription'

function idOf(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

export async function syncStripeApplicationAddonSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  const localId = subscription.metadata.keeprOnePlatformAddonSubscriptionId
  if (!localId) throw new Error('STRIPE_ADDON_SUBSCRIPTION_UNMAPPED')

  const local = await prisma.platformAddonSubscription.findUnique({
    where: { id: localId },
    select: { id: true, addon: true, stripeSubscriptionId: true },
  })
  if (!local || local.addon !== 'K_BOT_APPLICATION') {
    throw new Error('STRIPE_ADDON_SUBSCRIPTION_NOT_FOUND')
  }
  if (local.stripeSubscriptionId && local.stripeSubscriptionId !== subscription.id) {
    throw new Error('STRIPE_ADDON_SUBSCRIPTION_CONFLICT')
  }

  const item = subscription.items.data[0]
  if (!item || subscription.items.data.length !== 1) {
    throw new Error('STRIPE_ADDON_SUBSCRIPTION_ITEMS_INVALID')
  }
  assertKBotApplicationPrice(item.price)
  const catalog = getKBotApplicationCatalog()

  await prisma.platformAddonSubscription.update({
    where: { id: local.id },
    data: {
      status: toPlatformSubscriptionStatus(subscription.status as Stripe.Subscription.Status),
      stripeCustomerId: idOf(subscription.customer),
      stripeSubscriptionId: subscription.id,
      stripeProductId: catalog.productId,
      stripePriceId: item.price.id,
      unitAmountCents: catalog.unitAmountCents,
      currency: catalog.currency.toUpperCase(),
      currentPeriodStart: new Date(item.current_period_start * 1_000),
      currentPeriodEnd: new Date(item.current_period_end * 1_000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1_000)
        : null,
    },
  })
}
