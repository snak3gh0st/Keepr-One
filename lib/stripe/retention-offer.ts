import type Stripe from 'stripe'

/**
 * A single 50%-off coupon serves two commercially different moments:
 *
 * - TRIAL_CONVERSION: the agent is still inside the trial and has not paid yet.
 * - CANCEL_RETENTION: the agent already had access and is leaving.
 *
 * They share the coupon but never the eligibility check, because an account
 * that converted at a discount must not be able to collect the same discount
 * again on the way out.
 */
export type RetentionOfferReason = 'TRIAL_CONVERSION' | 'CANCEL_RETENTION'

export const RETENTION_OFFER_GRANTED_ACTION = 'BILLING_RETENTION_OFFER_GRANTED'

export type RetentionOffer = {
  couponId: string
  percentOff: number
  durationInMonths: number | null
  duration: Stripe.Coupon.Duration
}

/**
 * Returns the configured coupon id, or null when the offer is switched off.
 *
 * An unset variable is a deliberate, supported state: the discounted paths
 * disappear and full-price checkout keeps working. Only a malformed value
 * throws, because that is a configuration mistake rather than a decision.
 */
export function getConfiguredRetentionCouponId(): string | null {
  const value = process.env.STRIPE_RETENTION_COUPON_ID?.trim()
  if (!value) return null
  if (value.length > 128 || /\s/.test(value)) {
    throw new Error('STRIPE_RETENTION_COUPON_ID_INVALID')
  }
  return value
}

/**
 * Validates a coupon against what the product promises before it can reach a
 * Checkout Session. Stripe would happily accept an expired or fixed-amount
 * coupon; this refuses anything the pricing copy cannot honestly describe.
 */
export function assertUsableRetentionCoupon(
  coupon: Stripe.Coupon,
  expectedCouponId: string,
): RetentionOffer {
  if (
    coupon.id !== expectedCouponId
    || !coupon.valid
    || typeof coupon.percent_off !== 'number'
    || coupon.percent_off <= 0
    || coupon.percent_off >= 100
  ) {
    throw new Error('STRIPE_RETENTION_COUPON_UNUSABLE')
  }

  if (coupon.redeem_by !== null && coupon.redeem_by * 1_000 <= Date.now()) {
    throw new Error('STRIPE_RETENTION_COUPON_UNUSABLE')
  }

  if (coupon.duration === 'repeating' && !coupon.duration_in_months) {
    throw new Error('STRIPE_RETENTION_COUPON_UNUSABLE')
  }

  return {
    couponId: coupon.id,
    percentOff: coupon.percent_off,
    durationInMonths: coupon.duration_in_months ?? null,
    duration: coupon.duration,
  }
}

/**
 * The Checkout idempotency key must separate a discounted attempt from a
 * full-price one. Without the reason in the key, an agent who opens full-price
 * checkout and then accepts the offer inside the same half-hour bucket is
 * handed the earlier, undiscounted session back.
 */
export function checkoutIdempotencyKey(
  subscriptionId: string,
  reason: RetentionOfferReason | null,
  now = Date.now(),
): string {
  const bucket = Math.floor(now / 1_800_000)
  return `keeprone-checkout-${subscriptionId}-${reason ?? 'FULL_PRICE'}-${bucket}`
}
