import 'server-only'

import { formatPlanPrice, getPlatformPlanPriceCents, type PlatformPlanName } from '@/lib/plans'
import { prisma } from '@/lib/prisma'
import type { FounderAccessResolution } from '@/lib/founder-access'
import { getConfiguredRetentionCouponId } from '@/lib/stripe/retention-offer'
import type { RetentionOfferReason } from '@/lib/stripe/retention-offer'
import {
  hasAlreadyReceivedRetentionOffer,
  resolveRetentionEligibility,
} from './retention-eligibility'

export type RetentionOfferView = {
  reason: RetentionOfferReason
  percentOff: number
  durationInMonths: number | null
  fullPriceLabel: string
  discountedPriceLabel: string
  checkoutPath: string
}

/**
 * The percentage and duration shown here are configuration, not a Stripe read.
 *
 * Rendering a paywall must not depend on a live Stripe round-trip: the page
 * still has to load when Stripe is slow or down. The authoritative check runs
 * in /api/billing/checkout, which refuses to apply a coupon that no longer
 * matches this promise — so a stale label can never become a wrong charge.
 */
export const RETENTION_OFFER_PERCENT_OFF = 50
export const RETENTION_OFFER_DURATION_MONTHS = 3

export async function resolveRetentionOfferView(
  access: FounderAccessResolution,
  plan: PlatformPlanName,
  locale: string,
  now = new Date(),
): Promise<RetentionOfferView | null> {
  if (!getConfiguredRetentionCouponId()) return null
  if (!access.subscription) return null

  const alreadyGranted = await hasAlreadyReceivedRetentionOffer(
    prisma,
    access.subscription.id,
  )
  const eligibility = resolveRetentionEligibility(access, { alreadyGranted, now })
  if (!eligibility.eligible) return null

  const fullCents = getPlatformPlanPriceCents(plan)
  const discountedCents = Math.round(fullCents * (1 - RETENTION_OFFER_PERCENT_OFF / 100))

  return {
    reason: eligibility.reason,
    percentOff: RETENTION_OFFER_PERCENT_OFF,
    durationInMonths: RETENTION_OFFER_DURATION_MONTHS,
    fullPriceLabel: formatPlanPrice(fullCents, locale),
    discountedPriceLabel: formatPlanPrice(discountedCents, locale),
    checkoutPath: '/api/billing/checkout?offer=retention',
  }
}
