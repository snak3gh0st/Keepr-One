import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe/client'
import {
  assertKBotApplicationPrice,
  getKBotApplicationCatalog,
} from '@/lib/stripe/application-addon-catalog'

export const runtime = 'nodejs'

function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
    const agent = await getCurrentAgent()
    const user = await prisma.user.findUnique({
      where: { id: agent.userId },
      select: { email: true },
    })
    if (!user?.email) {
      return NextResponse.json({ error: 'AGENT_EMAIL_REQUIRED' }, { status: 409 })
    }

    const catalog = getKBotApplicationCatalog()
    const stripe = getStripeClient()
    const price = await stripe.prices.retrieve(catalog.priceId, { expand: ['product'] })
    assertKBotApplicationPrice(price)

    const local = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kbot-application:${agent.id}`}))`
      const baseSubscription = await tx.platformSubscription.findFirst({
        where: { agentId: agent.id, stripeCustomerId: { not: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { stripeCustomerId: true },
      })
      const existing = await tx.platformAddonSubscription.findFirst({
        where: {
          agentId: agent.id,
          addon: 'K_BOT_APPLICATION',
          status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      if (existing?.stripeSubscriptionId) throw new Error('ADDON_ALREADY_LINKED')
      if (existing) {
        return tx.platformAddonSubscription.update({
          where: { id: existing.id },
          data: {
            stripeProductId: catalog.productId,
            stripePriceId: catalog.priceId,
            unitAmountCents: catalog.unitAmountCents,
            currency: catalog.currency.toUpperCase(),
            stripeCustomerId: existing.stripeCustomerId ?? baseSubscription?.stripeCustomerId,
          },
        })
      }
      return tx.platformAddonSubscription.create({
        data: {
          agentId: agent.id,
          addon: 'K_BOT_APPLICATION',
          // Checkout is not entitlement. Provider truth changes this to TRIALING/ACTIVE.
          status: 'PAST_DUE',
          unitAmountCents: catalog.unitAmountCents,
          currency: catalog.currency.toUpperCase(),
          stripeProductId: catalog.productId,
          stripePriceId: catalog.priceId,
          stripeCustomerId: baseSubscription?.stripeCustomerId,
        },
      })
    })

    const origin = appOrigin(request)
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      integration_identifier: `keeprone_${randomBytes(6).toString('base64url').slice(0, 8).toLowerCase()}`,
      client_reference_id: local.id,
      ...(local.stripeCustomerId
        ? { customer: local.stripeCustomerId }
        : { customer_email: user.email }),
      line_items: [{ price: catalog.priceId, quantity: 1 }],
      metadata: {
        keeprOnePlatformAddonSubscriptionId: local.id,
        keeprOneAddon: 'K_BOT_APPLICATION',
        keeprOneAgentId: agent.id,
      },
      subscription_data: {
        trial_period_days: catalog.trialDays,
        metadata: {
          keeprOnePlatformAddonSubscriptionId: local.id,
          keeprOneAddon: 'K_BOT_APPLICATION',
          keeprOneAgentId: agent.id,
        },
      },
      success_url: `${origin}/api/billing/application-addon/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/agent/cases?application_addon=canceled`,
    }, {
      idempotencyKey: `keeprone-kbot-application-checkout-${local.id}-${Math.floor(Date.now() / 1_800_000)}`,
    })

    if (!checkout.url) throw new Error('STRIPE_CHECKOUT_URL_MISSING')
    return NextResponse.redirect(checkout.url, 303)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (code === 'ADDON_ALREADY_LINKED') {
      return NextResponse.json({ error: code }, { status: 409 })
    }
    console.error('K-Bot Application checkout creation failed', { code })
    return NextResponse.json({ error: 'CHECKOUT_UNAVAILABLE' }, { status: 503 })
  }
}
