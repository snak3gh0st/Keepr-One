import 'server-only'

import { prisma } from '@/lib/prisma'
import { finalizeAgencyInvitationAccess } from '@/lib/agency-invitation-finalization'
import { getStripeClient } from './client'
import {
  assertStripePriceMatchesPlan,
  getStripeInvitationCatalogEntry,
} from './platform-catalog'
import { toPlatformSubscriptionStatus } from './platform-subscription'

function idOf(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

export async function syncStripeAgencyInvitationSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['items.data.price.product'],
  })
  const checkoutId = subscription.metadata.keeprOneAgencyInvitationCheckoutId
  if (!checkoutId) throw new Error('STRIPE_INVITATION_SUBSCRIPTION_UNMAPPED')

  const checkout = await prisma.agencyInvitationCheckout.findUnique({
    where: { id: checkoutId },
    select: {
      id: true,
      invitationId: true,
      email: true,
      name: true,
      agencyName: true,
      passwordHash: true,
      userId: true,
      plan: true,
      status: true,
      unitAmountCents: true,
      stripeSubscriptionId: true,
      platformSubscriptionId: true,
    },
  })
  if (!checkout) throw new Error('STRIPE_INVITATION_SUBSCRIPTION_UNMAPPED')
  if (
    subscription.metadata.keeprOneAgencyInvitationId !== checkout.invitationId
    || subscription.metadata.keeprOneInvitationPlan !== checkout.plan
  ) {
    throw new Error('STRIPE_INVITATION_METADATA_MISMATCH')
  }
  if (
    checkout.stripeSubscriptionId
    && checkout.stripeSubscriptionId !== subscription.id
  ) {
    throw new Error('STRIPE_INVITATION_SUBSCRIPTION_CONFLICT')
  }
  if (checkout.plan !== 'AGENT_AGENCY_MEMBER' && checkout.plan !== 'AGENCY') {
    throw new Error('STRIPE_INVITATION_PLAN_INVALID')
  }

  const catalog = getStripeInvitationCatalogEntry(checkout.plan)
  const item = subscription.items.data[0]
  if (
    subscription.items.data.length !== 1
    || !item
    || checkout.unitAmountCents !== catalog.unitAmountCents
  ) {
    throw new Error('STRIPE_INVITATION_PLAN_INVALID')
  }
  assertStripePriceMatchesPlan(item.price, catalog)

  const provider = {
    status: toPlatformSubscriptionStatus(subscription.status),
    stripeCustomerId: idOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    stripeProductId: catalog.productId,
    stripePriceId: item.price.id,
    currentPeriodStart: new Date(item.current_period_start * 1_000),
    currentPeriodEnd: new Date(item.current_period_end * 1_000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1_000)
      : null,
  } as const

  if (checkout.status === 'FINALIZED') {
    if (!checkout.platformSubscriptionId) {
      throw new Error('STRIPE_INVITATION_FINALIZATION_INCOMPLETE')
    }
    await prisma.platformSubscription.update({
      where: { id: checkout.platformSubscriptionId },
      data: {
        ...provider,
        unitAmountCents: catalog.unitAmountCents,
        currency: catalog.currency.toUpperCase(),
      },
    })
    return
  }

  if (provider.status !== 'ACTIVE' && provider.status !== 'TRIALING') {
    throw new Error('STRIPE_INVITATION_SUBSCRIPTION_NOT_ACTIVE')
  }

  await finalizeAgencyInvitationAccess({
    checkoutId: checkout.id,
    invitationId: checkout.invitationId,
    expectedUserId: checkout.userId,
    invitedEmail: checkout.email,
    name: checkout.name,
    agencyName: checkout.agencyName,
    passwordHash: checkout.passwordHash,
    plan: checkout.plan,
    unitAmountCents: checkout.unitAmountCents,
    provider,
  })
}
