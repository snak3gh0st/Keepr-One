import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe/client'
import { toPlatformSubscriptionStatus } from '@/lib/stripe/platform-subscription'
import { lockAgent } from './credits'
import { positiveInteger, FollowupError } from './domain'

export function followupCatalog() {
  const priceId = process.env.STRIPE_KBOT_FOLLOWUP_PRICE_ID
  const productId = process.env.STRIPE_KBOT_FOLLOWUP_PRODUCT_ID
  if (!priceId?.startsWith('price_') || !productId?.startsWith('prod_')) return null
  const tokens = positiveInteger(process.env.KBOT_FOLLOWUP_PAID_TOKENS, 100_000, 10_000_000)
  const cents = positiveInteger(process.env.KBOT_FOLLOWUP_MONTHLY_CENTS, 900)
  if (!tokens || !cents) return null
  return { priceId, productId, tokens, cents }
}
export function assertFollowupPrice(price: Stripe.Price) {
  const catalog = followupCatalog()
  const product = typeof price.product === 'string' ? price.product : price.product.id
  if (!catalog || price.id !== catalog.priceId || product !== catalog.productId || !price.active || price.currency !== 'usd' ||
    price.unit_amount !== catalog.cents || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.recurring.usage_type !== 'licensed') {
    throw new FollowupError('FOLLOWUP_PRICE_MISMATCH')
  }
  return catalog
}

export async function syncFollowupSubscription(subscriptionId: string) {
  const stripe = getStripeClient()
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const localId = subscription.metadata.keeprOnePlatformAddonSubscriptionId
  if (subscription.metadata.keeprOneAddon !== 'K_BOT_FOLLOWUP' || !localId) throw new FollowupError('ADDON_UNMAPPED')
  const local = await prisma.platformAddonSubscription.findUnique({ where: { id: localId } })
  if (!local || local.addon !== 'K_BOT_FOLLOWUP' || subscription.metadata.keeprOneAgentId !== local.agentId ||
    (local.stripeSubscriptionId && local.stripeSubscriptionId !== subscription.id)) throw new FollowupError('ADDON_CONFLICT')
  if (subscription.items.data.length !== 1 || subscription.items.data[0].quantity !== 1) throw new FollowupError('ADDON_ITEMS_INVALID')
  const item = subscription.items.data[0]
  const catalog = assertFollowupPrice(item.price)
  await prisma.$transaction(async tx => {
    await lockAgent(tx, local.agentId)
    const fresh = await tx.platformAddonSubscription.findUniqueOrThrow({ where: { id: local.id } })
    if (fresh.stripeSubscriptionId && fresh.stripeSubscriptionId !== subscription.id) throw new FollowupError('ADDON_CONFLICT')
    await tx.platformAddonSubscription.update({ where: { id: local.id }, data: {
      status: toPlatformSubscriptionStatus(subscription.status), stripeSubscriptionId: subscription.id,
      stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripePriceId: catalog.priceId, stripeProductId: catalog.productId, unitAmountCents: catalog.cents,
      currentPeriodStart: new Date(item.current_period_start * 1000), currentPeriodEnd: new Date(item.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end, canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    } })
  })
}

export async function grantPaidFollowupInvoice(invoiceId: string) {
  const stripe = getStripeClient()
  const invoice = await stripe.invoices.retrieve(invoiceId)
  const sub = invoice.parent?.subscription_details?.subscription
  const subscriptionId = typeof sub === 'string' ? sub : sub?.id
  if (!subscriptionId || invoice.status !== 'paid') return
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  if (subscription.metadata.keeprOneAddon !== 'K_BOT_FOLLOWUP') return
  await syncFollowupSubscription(subscriptionId)
  const catalog = followupCatalog()!
  // Only full subscription cycles grant credits; prorations never refill the wallet.
  if (!['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason ?? '')) return
  const line = invoice.lines.data.find(l => l.pricing?.price_details?.price === catalog.priceId && l.quantity === 1)
  if (!line || invoice.lines.has_more) throw new FollowupError('INVOICE_LINE_INVALID')
  const local = await prisma.platformAddonSubscription.findUniqueOrThrow({ where: { stripeSubscriptionId: subscriptionId } })
  const credits = Number(subscription.metadata.keeprOneFollowupTokens)
  if (!Number.isInteger(credits) || credits <= 0 || credits > 10_000_000) throw new FollowupError('INVOICE_CREDITS_INVALID')
  await prisma.$transaction(async tx => {
    await lockAgent(tx, local.agentId)
    await tx.kBotCreditGrant.upsert({ where: { sourceKey: `invoice:${invoice.id}` }, update: {}, create: {
      agentId: local.agentId, sourceKey: `invoice:${invoice.id}`, allowance: credits, expiresAt: new Date(line.period.end * 1000),
    } })
  })
}
