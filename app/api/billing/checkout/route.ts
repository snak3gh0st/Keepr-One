import { NextResponse } from 'next/server'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { getStripeClient } from '@/lib/stripe/client'
import {
  assertStripePriceMatchesPlan,
  getStripeCatalogEntry,
} from '@/lib/stripe/platform-catalog'

export const runtime = 'nodejs'

function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
    const session = await requireRoleWithoutFounderAccess('AGENT')
    const impersonatedBy = (session.session as { impersonatedBy?: unknown }).impersonatedBy
    if (typeof impersonatedBy === 'string') {
      return NextResponse.json({ error: 'READ_ONLY_USER_PREVIEW' }, { status: 403 })
    }
    const agent = await prisma.agent.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (!agent) return NextResponse.json({ error: 'AGENT_NOT_FOUND' }, { status: 404 })

    const access = await resolveFounderAccessForAgent(agent.id)
    if (access.state === 'LEGACY' || !access.requiredPlan || !access.subscription) {
      return NextResponse.json({ error: 'SUBSCRIPTION_NOT_ELIGIBLE' }, { status: 409 })
    }
    const catalog = getStripeCatalogEntry(access.requiredPlan)
    if (!catalog) {
      return NextResponse.json({ error: 'STRIPE_PLAN_UNAVAILABLE' }, { status: 409 })
    }

    const local = await prisma.platformSubscription.findUnique({
      where: { id: access.subscription.id },
      select: { id: true, stripeCustomerId: true, stripeSubscriptionId: true },
    })
    if (!local) return NextResponse.json({ error: 'SUBSCRIPTION_NOT_FOUND' }, { status: 404 })
    if (local.stripeSubscriptionId) {
      return NextResponse.json({ error: 'SUBSCRIPTION_ALREADY_LINKED' }, { status: 409 })
    }

    const stripe = getStripeClient()
    const price = await stripe.prices.retrieve(catalog.priceId, { expand: ['product'] })
    assertStripePriceMatchesPlan(price, catalog)

    await prisma.platformSubscription.update({
      where: { id: local.id },
      data: { stripeProductId: catalog.productId, stripePriceId: catalog.priceId },
    })

    const origin = appOrigin(request)
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: local.id,
      ...(local.stripeCustomerId
        ? { customer: local.stripeCustomerId }
        : { customer_email: session.user.email }),
      line_items: [{ price: catalog.priceId, quantity: 1 }],
      metadata: {
        keeprOnePlatformSubscriptionId: local.id,
        keeprOneAgentId: agent.id,
      },
      subscription_data: {
        metadata: {
          keeprOnePlatformSubscriptionId: local.id,
          keeprOneAgentId: agent.id,
        },
      },
      success_url: `${origin}/api/billing/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/founders/expired?billing=canceled`,
    }, {
      idempotencyKey: `keeprone-checkout-${local.id}-${Math.floor(Date.now() / 1_800_000)}`,
    })

    if (!checkout.url) throw new Error('STRIPE_CHECKOUT_URL_MISSING')
    return NextResponse.redirect(checkout.url, 303)
  } catch (error) {
    console.error('Stripe checkout creation failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.json({ error: 'CHECKOUT_UNAVAILABLE' }, { status: 503 })
  }
}
