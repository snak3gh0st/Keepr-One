import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import type { FounderAccessResolution } from '@/lib/founder-access'
import {
  RETENTION_OFFER_GRANTED_ACTION,
  type RetentionOfferReason,
} from '@/lib/stripe/retention-offer'

type Database = PrismaClient | Prisma.TransactionClient

/** How close to the end of the trial the conversion offer starts appearing. */
export const TRIAL_CONVERSION_OFFER_WINDOW_DAYS = 7
const DAY_MS = 86_400_000

export type RetentionEligibility =
  | { eligible: true; reason: RetentionOfferReason }
  | { eligible: false; refusal: RetentionEligibilityRefusal }

export type RetentionEligibilityRefusal =
  | 'ALREADY_GRANTED'
  | 'LEGACY_ACCESS'
  | 'NO_SUBSCRIPTION'
  | 'ALREADY_PAID'
  | 'OUTSIDE_TRIAL_WINDOW'

/**
 * The discount is granted at most once per subscription, across both moments.
 * The grant is recorded in AuditLog rather than on the subscription row so the
 * decision is visible in the administrative log next to every other commercial
 * action, and so this needs no schema migration against a live database.
 */
export async function hasAlreadyReceivedRetentionOffer(
  database: Database,
  platformSubscriptionId: string,
): Promise<boolean> {
  const granted = await database.auditLog.findFirst({
    where: {
      action: RETENTION_OFFER_GRANTED_ACTION,
      entity: 'PlatformSubscription',
      entityId: platformSubscriptionId,
    },
    select: { id: true },
  })
  return granted !== null
}

export async function recordRetentionOfferGranted(
  database: Database,
  input: {
    userId: string
    platformSubscriptionId: string
    reason: RetentionOfferReason
    couponId: string
    /** What Stripe actually took off the first invoice, in cents. */
    discountedAmountCents?: number | null
  },
): Promise<void> {
  await database.auditLog.create({
    data: {
      userId: input.userId,
      action: RETENTION_OFFER_GRANTED_ACTION,
      entity: 'PlatformSubscription',
      entityId: input.platformSubscriptionId,
      after: {
        reason: input.reason,
        couponId: input.couponId,
        discountedAmountCents: input.discountedAmountCents ?? null,
      },
    },
  })
}

/**
 * Decides whether an account may be shown the discount, and under which of the
 * two commercial reasons.
 *
 * This is deliberately separate from authorization: founder-access still
 * decides whether the account may use the product at all. This only decides
 * whether the discounted path is offered instead of full price.
 */
export function resolveRetentionEligibility(
  access: Pick<FounderAccessResolution, 'state' | 'subscription' | 'trialEndsAt'>,
  options: { alreadyGranted: boolean; now?: Date },
): RetentionEligibility {
  if (options.alreadyGranted) {
    return { eligible: false, refusal: 'ALREADY_GRANTED' }
  }
  if (access.state === 'LEGACY') {
    return { eligible: false, refusal: 'LEGACY_ACCESS' }
  }
  if (!access.subscription) {
    return { eligible: false, refusal: 'NO_SUBSCRIPTION' }
  }

  // An account that already pays full price is not in either discount moment.
  // Winning it back belongs to the cancellation flow, which reaches this
  // function again once the subscription is no longer ACTIVE.
  if (access.state === 'PAID' && !access.subscription.cancelAtPeriodEnd) {
    return { eligible: false, refusal: 'ALREADY_PAID' }
  }

  if (access.state === 'EXPIRED' || access.subscription.cancelAtPeriodEnd) {
    return { eligible: true, reason: 'CANCEL_RETENTION' }
  }

  const now = options.now ?? new Date()
  const endsAt = access.trialEndsAt ?? access.subscription.currentPeriodEnd
  if (!endsAt) return { eligible: false, refusal: 'OUTSIDE_TRIAL_WINDOW' }

  const remainingMs = endsAt.getTime() - now.getTime()
  if (remainingMs > TRIAL_CONVERSION_OFFER_WINDOW_DAYS * DAY_MS) {
    return { eligible: false, refusal: 'OUTSIDE_TRIAL_WINDOW' }
  }

  return { eligible: true, reason: 'TRIAL_CONVERSION' }
}
