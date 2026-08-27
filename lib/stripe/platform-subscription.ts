import 'server-only'

import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getStripeCatalogEntry, assertStripePriceMatchesPlan } from './platform-catalog'
import { getStripeClient } from './client'

type LocalSubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

export function toPlatformSubscriptionStatus(
  status: Stripe.Subscription.Status,
): LocalSubscriptionStatus {
  switch (status) {
    case 'trialing': return 'TRIALING'
    case 'active': return 'ACTIVE'
    case 'canceled': return 'CANCELED'
    case 'incomplete_expired': return 'EXPIRED'
    default: return 'PAST_DUE'
  }
}

function idOf(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

export async function syncStripePlatformSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  const stripe = getStripeClient()
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  const localSubscriptionId = subscription.metadata.keeprOnePlatformSubscriptionId
  if (!localSubscriptionId) throw new Error('STRIPE_SUBSCRIPTION_UNMAPPED')

  const local = await prisma.platformSubscription.findUnique({
    where: { id: localSubscriptionId },
    select: { id: true, plan: true, stripeSubscriptionId: true },
  })
  if (!local) throw new Error('STRIPE_SUBSCRIPTION_UNMAPPED')
  if (local.stripeSubscriptionId && local.stripeSubscriptionId !== subscription.id) {
    throw new Error('STRIPE_SUBSCRIPTION_CONFLICT')
  }

  const catalog = getStripeCatalogEntry(local.plan)
  const item = subscription.items.data[0]
  if (!catalog || subscription.items.data.length !== 1 || !item) {
    throw new Error('STRIPE_SUBSCRIPTION_PLAN_INVALID')
  }
  assertStripePriceMatchesPlan(item.price, catalog)

  await prisma.platformSubscription.update({
    where: { id: local.id },
    data: {
      status: toPlatformSubscriptionStatus(subscription.status),
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
