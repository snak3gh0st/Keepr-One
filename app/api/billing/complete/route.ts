import { NextResponse } from 'next/server'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripePlatformSubscription } from '@/lib/stripe/platform-subscription'
import { recordRetentionOfferGranted } from '@/lib/billing/retention-eligibility'
import type { RetentionOfferReason } from '@/lib/stripe/retention-offer'

export const runtime = 'nodejs'

function subscriptionId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

/** The coupon Stripe ended up applying, or a marker when it cannot be read. */
async function appliedCouponId(stripeSubscriptionId: string): Promise<string> {
  try {
    const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['discounts'],
    })
    const discounts = (subscription as unknown as { discounts?: unknown[] }).discounts ?? []
    for (const entry of discounts) {
      const coupon = (entry as { coupon?: { id?: unknown } } | string | null)
      if (coupon && typeof coupon === 'object' && typeof coupon.coupon?.id === 'string') {
        return coupon.coupon.id
      }
    }
  } catch (error) {
    console.error('Could not read the applied coupon back from Stripe', error)
  }
  return 'UNREADABLE'
}

function grantedOfferReason(checkout: { metadata?: Record<string, string> | null }): RetentionOfferReason | null {
  const value = checkout.metadata?.keeprOneRetentionOfferReason
  return value === 'TRIAL_CONVERSION' || value === 'CANCEL_RETENTION' ? value : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const checkoutSessionId = url.searchParams.get('session_id')
  if (!checkoutSessionId || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(checkoutSessionId)) {
    return NextResponse.redirect(new URL('/founders/expired?billing=invalid', url), 303)
  }

  try {
    const session = await requireRoleWithoutFounderAccess('AGENT')
    const agent = await prisma.agent.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (!agent) throw new Error('AGENT_NOT_FOUND')

    const access = await resolveFounderAccessForAgent(agent.id)
    const checkout = await getStripeClient().checkout.sessions.retrieve(checkoutSessionId)
    if (
      checkout.status !== 'complete' ||
      !access.subscription ||
      checkout.client_reference_id !== access.subscription.id
    ) {
      throw new Error('CHECKOUT_TENANT_MISMATCH')
    }
    const stripeSubscriptionId = subscriptionId(checkout.subscription)
    if (!stripeSubscriptionId) throw new Error('CHECKOUT_SUBSCRIPTION_MISSING')

    await syncStripePlatformSubscription(stripeSubscriptionId)

    // Redemption, not the mere intent to redeem, is what consumes the one
    // discount an account gets. Recording it here — after Stripe confirmed the
    // subscription — keeps an abandoned Checkout from costing the agent their
    // offer, while still preventing a second discount later at cancellation.
    const offerReason = grantedOfferReason(checkout)
    if (offerReason) {
      try {
        const discount = checkout.total_details?.amount_discount ?? null
        await recordRetentionOfferGranted(prisma, {
          userId: session.user.id,
          platformSubscriptionId: access.subscription.id,
          reason: offerReason,
          // Read back from the subscription rather than from configuration, so
          // the audit row records the coupon Stripe actually applied.
          couponId: await appliedCouponId(stripeSubscriptionId),
          discountedAmountCents: discount,
        })
      } catch (auditError) {
        // Access was already granted by the sync above. A failed audit write
        // must never turn a paid subscription into an error page.
        console.error('Could not record the retention offer redemption', auditError)
      }
    }

    return NextResponse.redirect(new URL('/agent?billing=active', url), 303)
  } catch (error) {
    console.error('Stripe checkout completion failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.redirect(new URL('/founders/expired?billing=pending', url), 303)
  }
}
