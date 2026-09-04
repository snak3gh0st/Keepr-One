import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { PlatformPlanName } from '@/lib/plans'
import { getStripeClient } from './client'
import {
  assertStripePriceMatchesPlan,
  getStripeInvitationCatalogEntry,
} from './platform-catalog'

type InvitedPlan = Extract<PlatformPlanName, 'AGENT_AGENCY_MEMBER' | 'AGENCY'>

type CreateAgencyInvitationCheckoutInput = {
  invitationId: string
  invitedEmail: string
  name: string
  agencyName: string | null
  passwordHash: string | null
  userId: string | null
  plan: InvitedPlan
  inviterRole: 'OWNER' | 'MEMBER'
  unitAmountCents: number
  acceptedTermsAt: Date
  invitationExpiresAt: Date
  origin: string
  invitationToken: string
  stripeCustomerId?: string | null
}

const checkoutSnapshotSelect = {
  id: true,
  invitationId: true,
  status: true,
  attemptNumber: true,
  stripeCheckoutSessionId: true,
  stripeSubscriptionId: true,
  finalizedAt: true,
  email: true,
  plan: true,
  unitAmountCents: true,
  checkoutExpiresAt: true,
  stripeCustomerId: true,
  stripeProductId: true,
  stripePriceId: true,
  checkoutRedirectFingerprint: true,
  checkoutAttemptStartedAt: true,
} as const satisfies Prisma.AgencyInvitationCheckoutSelect

type CheckoutSnapshot = Prisma.AgencyInvitationCheckoutGetPayload<{
  select: typeof checkoutSnapshotSelect
}>

export async function createStripeAgencyInvitationCheckout(
  input: CreateAgencyInvitationCheckoutInput,
): Promise<{ checkoutUrl: string; checkoutId: string }> {
  return reserveAndCreateInvitationCheckout(input, 3)
}

async function reserveAndCreateInvitationCheckout(
  input: CreateAgencyInvitationCheckoutInput,
  reservationRetries: number,
): Promise<{ checkoutUrl: string; checkoutId: string }> {
  if (reservationRetries === 0) throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
  // Bind redirects without storing the invitation's bearer token or full URL.
  const redirectFingerprint = createHash('sha256')
    .update(JSON.stringify([input.origin, input.invitationToken]))
    .digest('hex')
  const stripe = getStripeClient()
  const existing = await prisma.agencyInvitationCheckout.findUnique({
    where: { invitationId: input.invitationId },
    select: checkoutSnapshotSelect,
  })
  let local: CheckoutSnapshot | undefined
  if (existing) {
    if (existing.status === 'FINALIZED' || existing.stripeSubscriptionId || existing.finalizedAt) {
      throw new Error('STRIPE_INVITATION_ALREADY_FINALIZED')
    }
    if (existing.stripeCheckoutSessionId) {
      const checkout = await stripe.checkout.sessions.retrieve(existing.stripeCheckoutSessionId)
      if (
        checkout.status === 'open'
        && checkout.client_reference_id === existing.id
        && checkout.url
      ) {
        return { checkoutUrl: checkout.url, checkoutId: existing.id }
      }
      if (checkout.status === 'complete') {
        throw new Error('STRIPE_INVITATION_CHECKOUT_PROCESSING')
      }
      if (checkout.status !== 'expired') {
        throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
      }
    } else {
      // A non-null marker belongs to either a legacy row or an attempt that
      // may have reached Stripe. Only this implementation writes null before
      // the preflight, so uncertain rows must be reconciled rather than renewed.
      if (!existing.checkoutRedirectFingerprint) {
        throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
      }
      if (existing.checkoutExpiresAt.getTime() > Date.now()) {
        // Stripe may have accepted the request even if saving its ID failed.
        // Until expiry, this attempt's snapshot and key must never be replaced.
        if (existing.checkoutRedirectFingerprint !== redirectFingerprint) {
          throw new Error('STRIPE_INVITATION_REDIRECT_MISMATCH')
        }
        local = existing
      } else if (existing.checkoutAttemptStartedAt) {
        // The local expiry cannot prove a marked provider call did not create
        // or later finalize a Checkout session. Reconciliation is required.
        throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
      }
    }
  }

  if (!local) {
    const catalog = getStripeInvitationCatalogEntry(input.plan)
    if (input.unitAmountCents !== catalog.unitAmountCents) {
      throw new Error('STRIPE_INVITATION_AMOUNT_MISMATCH')
    }
    const acceptedAt = input.acceptedTermsAt.getTime()
    const invitationExpiresAt = input.invitationExpiresAt.getTime()
    if (
      !Number.isFinite(acceptedAt)
      || !Number.isFinite(invitationExpiresAt)
      || invitationExpiresAt <= acceptedAt + 31 * 60 * 1_000
    ) {
      throw new Error('STRIPE_INVITATION_EXPIRY_TOO_CLOSE')
    }
    const checkoutExpiresAt = Math.floor(Math.min(
      invitationExpiresAt,
      acceptedAt + 23 * 60 * 60 * 1_000,
    ) / 1_000)
    if (checkoutExpiresAt * 1_000 <= Date.now() + 30 * 60 * 1_000) {
      throw new Error('STRIPE_INVITATION_EXPIRY_TOO_CLOSE')
    }
    const price = await stripe.prices.retrieve(catalog.priceId, { expand: ['product'] })
    assertStripePriceMatchesPlan(price, catalog)

    const pendingData = {
      email: input.invitedEmail,
      name: input.name,
      agencyName: input.agencyName,
      passwordHash: input.passwordHash,
      userId: input.userId,
      plan: input.plan,
      inviterRole: input.inviterRole,
      unitAmountCents: input.unitAmountCents,
      acceptedTermsAt: input.acceptedTermsAt,
      checkoutExpiresAt: new Date(checkoutExpiresAt * 1_000),
      stripeProductId: catalog.productId,
      stripePriceId: catalog.priceId,
      stripeCustomerId: input.stripeCustomerId ?? null,
      checkoutRedirectFingerprint: redirectFingerprint,
      // The database default marks legacy/older-binary inserts as uncertain.
      // New reservations explicitly start unmarked until this function's CAS.
      checkoutAttemptStartedAt: null,
    }
    if (existing) {
      // A retrieved expired session or an elapsed reservation that never
      // reached the provider proves this is a new attempt. Only then may new
      // input replace the persisted snapshot.
      const reserved = await prisma.agencyInvitationCheckout.updateMany({
        where: {
          id: existing.id,
          attemptNumber: existing.attemptNumber,
          status: existing.status,
          stripeCheckoutSessionId: existing.stripeCheckoutSessionId,
          stripeSubscriptionId: null,
          finalizedAt: null,
          checkoutAttemptStartedAt: existing.checkoutAttemptStartedAt,
        },
        data: {
          ...pendingData,
          attemptNumber: { increment: 1 },
          stripeCheckoutSessionId: null,
        },
      })
      if (reserved.count !== 1) {
        // Another caller owns the next attempt. Re-read its snapshot and reuse
        // its key instead of incrementing the stale attempt again.
        return reserveAndCreateInvitationCheckout(input, reservationRetries - 1)
      }
      local = {
        ...existing,
        ...pendingData,
        attemptNumber: existing.attemptNumber + 1,
        stripeCheckoutSessionId: null,
      }
    } else {
      try {
        local = await prisma.$transaction(async (transaction) => {
          const invitation = await transaction.agencyInvitation.findUnique({
            where: { id: input.invitationId },
            select: { id: true, status: true, expiresAt: true },
          })
          if (
            !invitation
            || invitation.status !== 'PENDING'
            || invitation.expiresAt.getTime() !== input.invitationExpiresAt.getTime()
          ) {
            throw new Error('AGENCY_INVITATION_NOT_RESERVABLE')
          }
          return transaction.agencyInvitationCheckout.create({
            data: { invitationId: input.invitationId, ...pendingData, attemptNumber: 1 },
            select: checkoutSnapshotSelect,
          })
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      } catch (error) {
        // The unique invitation key / serializable transaction chooses one
        // initial reservation. A loser must use that committed attempt.
        if (error && typeof error === 'object' && 'code' in error
          && (error.code === 'P2002' || error.code === 'P2034')) {
          return reserveAndCreateInvitationCheckout(input, reservationRetries - 1)
        }
        throw error
      }
    }
  }

  if (!local.checkoutAttemptStartedAt) {
    const checkoutAttemptStartedAt = new Date()
    const started = await prisma.agencyInvitationCheckout.updateMany({
      where: {
        id: local.id,
        attemptNumber: local.attemptNumber,
        status: local.status,
        stripeCheckoutSessionId: null,
        stripeSubscriptionId: null,
        finalizedAt: null,
        checkoutAttemptStartedAt: null,
      },
      data: { checkoutAttemptStartedAt },
    })
    if (started.count !== 1) {
      // Another caller owns this attempt. Re-read its marker and reuse the
      // same idempotency key instead of creating another payable session.
      return reserveAndCreateInvitationCheckout(input, reservationRetries - 1)
    }
    local = { ...local, checkoutAttemptStartedAt }
  }

  const metadata = {
    keeprOneAgencyInvitationCheckoutId: local.id,
    keeprOneAgencyInvitationId: local.invitationId,
    keeprOneInvitationPlan: local.plan,
  }
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: local.id,
    ...(local.stripeCustomerId
      ? { customer: local.stripeCustomerId }
      : { customer_email: local.email }),
    line_items: [{ price: local.stripePriceId, quantity: 1 }],
    expires_at: Math.floor(local.checkoutExpiresAt.getTime() / 1_000),
    metadata,
    subscription_data: { metadata },
    success_url: `${input.origin}/api/billing/invitation/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/convites/agencia/${encodeURIComponent(input.invitationToken)}?billing=canceled`,
  }, {
    idempotencyKey: `keeprone-agency-invitation-${local.id}-${local.attemptNumber}`,
  })
  if (!checkout.url) throw new Error('STRIPE_CHECKOUT_URL_MISSING')

  const saved = await prisma.agencyInvitationCheckout.updateMany({
    where: {
      id: local.id,
      attemptNumber: local.attemptNumber,
      status: local.status,
      stripeSubscriptionId: null,
      finalizedAt: null,
      OR: [{ stripeCheckoutSessionId: null }, { stripeCheckoutSessionId: checkout.id }],
    },
    data: { stripeCheckoutSessionId: checkout.id },
  })
  if (saved.count !== 1) {
    const current = await prisma.agencyInvitationCheckout.findUnique({
      where: { id: local.id },
      select: checkoutSnapshotSelect,
    })
    // A late response cannot associate its session with a newer attempt or
    // overwrite a finalized result. Do not initiate another checkout here.
    if (current?.stripeSubscriptionId || current?.finalizedAt || current?.status === 'FINALIZED') {
      throw new Error('STRIPE_INVITATION_CHECKOUT_PROCESSING')
    }
    throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
  }

  return { checkoutUrl: checkout.url, checkoutId: local.id }
}
