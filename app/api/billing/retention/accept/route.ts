import { NextResponse } from 'next/server'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripePlatformSubscription } from '@/lib/stripe/platform-subscription'
import {
  assertUsableRetentionCoupon,
  getConfiguredRetentionCouponId,
} from '@/lib/stripe/retention-offer'
import {
  hasAlreadyReceivedRetentionOffer,
  recordRetentionOfferGranted,
  resolveRetentionEligibility,
} from '@/lib/billing/retention-eligibility'

export const runtime = 'nodejs'

/**
 * Accepts the retention offer on a subscription that already exists in Stripe.
 *
 * This is the cancellation counterpart to /api/billing/checkout. An agent who
 * scheduled a cancellation still has a live Stripe subscription, so there is no
 * Checkout Session to create — the coupon is applied to the subscription itself
 * and the pending cancellation is cleared in the same call.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginAction({
      origin: request.headers.get('origin'),
      host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    })

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

    const couponId = getConfiguredRetentionCouponId()
    if (!couponId) return NextResponse.json({ error: 'OFFER_UNAVAILABLE' }, { status: 409 })

    const access = await resolveFounderAccessForAgent(agent.id)
    if (!access.subscription) {
      return NextResponse.json({ error: 'SUBSCRIPTION_NOT_ELIGIBLE' }, { status: 409 })
    }

    const alreadyGranted = await hasAlreadyReceivedRetentionOffer(
      prisma,
      access.subscription.id,
    )
    const eligibility = resolveRetentionEligibility(access, { alreadyGranted })
    if (!eligibility.eligible) {
      return NextResponse.json({ error: eligibility.refusal }, { status: 409 })
    }

    const local = await prisma.platformSubscription.findUnique({
      where: { id: access.subscription.id },
      select: { id: true, stripeSubscriptionId: true },
    })
    if (!local?.stripeSubscriptionId) {
      // Without a live Stripe subscription there is nothing to amend; that
      // account belongs on the Checkout path instead.
      return NextResponse.json({ error: 'SUBSCRIPTION_NOT_LINKED' }, { status: 409 })
    }

    const stripe = getStripeClient()
    const coupon = await stripe.coupons.retrieve(couponId)
    const offer = assertUsableRetentionCoupon(coupon, couponId)

    const updated = await stripe.subscriptions.update(
      local.stripeSubscriptionId,
      {
        cancel_at_period_end: false,
        discounts: [{ coupon: offer.couponId }],
        metadata: { keeprOneRetentionOfferReason: eligibility.reason },
      },
      { idempotencyKey: `keeprone-retention-accept-${local.id}-${offer.couponId}` },
    )

    await syncStripePlatformSubscription(updated.id)

    try {
      await recordRetentionOfferGranted(prisma, {
        userId: session.user.id,
        platformSubscriptionId: local.id,
        reason: eligibility.reason,
        couponId: offer.couponId,
      })
    } catch (auditError) {
      // The discount is already live in Stripe and the local row is synced.
      // A failed audit write must not undo a commercial decision the agent made.
      console.error('Could not record the retention offer acceptance', auditError)
    }

    return NextResponse.redirect(new URL('/agent?billing=retained', request.url), 303)
  } catch (error) {
    console.error('Retention offer acceptance failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.json({ error: 'RETENTION_UNAVAILABLE' }, { status: 503 })
  }
}
