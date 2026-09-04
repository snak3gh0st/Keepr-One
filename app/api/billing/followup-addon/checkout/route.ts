import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { getStripeClient } from '@/lib/stripe/client'
import { followupCatalog, assertFollowupPrice } from '@/lib/kbot-followup/billing'
import { lockAgent } from '@/lib/kbot-followup/credits'
import { featureEnabled } from '@/lib/kbot-followup/domain'

export async function POST(request: Request) {
  try {
    assertSameOriginAction({ origin: request.headers.get('origin'), host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'), forwardedProto: request.headers.get('x-forwarded-proto') })
  } catch { return Response.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  try {
    const agent = await getCurrentAgent()
    const catalog = followupCatalog()
    if (!featureEnabled() || !catalog) return Response.json({ error: 'CHECKOUT_UNAVAILABLE' }, { status: 503 })
    const stripe = getStripeClient()
    assertFollowupPrice(await stripe.prices.retrieve(catalog.priceId))
    const user = await prisma.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { email: true } })
    const local = await prisma.$transaction(async tx => {
      await lockAgent(tx, agent.id)
      const base = await tx.platformSubscription.findFirst({ where: { agentId: agent.id, stripeCustomerId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { stripeCustomerId: true } })
      const existing = await tx.platformAddonSubscription.findFirst({ where: { agentId: agent.id, addon: 'K_BOT_FOLLOWUP', status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } }, orderBy: { createdAt: 'desc' } })
      if (existing?.stripeSubscriptionId) throw new Error('ADDON_ALREADY_LINKED')
      if (existing?.checkoutExpiresAt && existing.checkoutExpiresAt > new Date()) return existing
      if (existing?.stripeCheckoutSessionId) {
        const prior = await stripe.checkout.sessions.retrieve(existing.stripeCheckoutSessionId)
        // A completed checkout awaiting its webhook must never create a second subscription.
        if (prior.status !== 'expired') throw new Error('CHECKOUT_PENDING_SYNC')
      }
      if (existing) return tx.platformAddonSubscription.update({ where: { id: existing.id }, data: {
        checkoutExpiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000), stripeCheckoutSessionId: null,
      } })
      return tx.platformAddonSubscription.create({ data: { agentId: agent.id, addon: 'K_BOT_FOLLOWUP', status: 'PAST_DUE',
        unitAmountCents: catalog.cents, stripePriceId: catalog.priceId, stripeProductId: catalog.productId,
        stripeCustomerId: base?.stripeCustomerId,
        checkoutExpiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000) } })
    }, { timeout: 20_000 })
    if (local.stripeCheckoutSessionId) {
      const previous = await stripe.checkout.sessions.retrieve(local.stripeCheckoutSessionId)
      if (previous.status === 'open' && previous.url) return NextResponse.redirect(previous.url, 303)
      throw new Error('CHECKOUT_PENDING_SYNC')
    }
    const metadata = { keeprOnePlatformAddonSubscriptionId: local.id, keeprOneAddon: 'K_BOT_FOLLOWUP', keeprOneAgentId: agent.id, keeprOneFollowupTokens: String(catalog.tokens) }
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
    if (!origin) throw new Error('APP_ORIGIN_REQUIRED')
    const session = await stripe.checkout.sessions.create({ mode: 'subscription',
      integration_identifier: `keeprone_${local.id.slice(-8).replace(/[^a-z]/gi, 'a').toLowerCase()}`,
      ...(local.stripeCustomerId ? { customer: local.stripeCustomerId } : { customer_email: user.email }),
      client_reference_id: local.id, line_items: [{ price: catalog.priceId, quantity: 1 }],
      metadata, subscription_data: { metadata }, expires_at: Math.floor(local.checkoutExpiresAt!.getTime() / 1000),
      success_url: `${origin.replace(/\/$/, '')}/agent/kbot?checkout=complete`, cancel_url: `${origin.replace(/\/$/, '')}/agent/kbot`,
    }, { idempotencyKey: `kbot-followup-checkout:${local.id}:${local.checkoutExpiresAt!.getTime()}` })
    if (!session.url) throw new Error('CHECKOUT_URL_MISSING')
    await prisma.platformAddonSubscription.updateMany({ where: { id: local.id, checkoutExpiresAt: local.checkoutExpiresAt }, data: { stripeCheckoutSessionId: session.id } })
    return NextResponse.redirect(session.url, 303)
  } catch { return Response.json({ error: 'CHECKOUT_UNAVAILABLE' }, { status: 503 }) }
}
