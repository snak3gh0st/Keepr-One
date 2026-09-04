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
  email: true,
  plan: true,
  unitAmountCents: true,
  checkoutExpiresAt: true,
  stripeCustomerId: true,
  stripeProductId: true,
  stripePriceId: true,
  checkoutRedirectFingerprint: true,
} as const satisfies Prisma.AgencyInvitationCheckoutSelect

type CheckoutSnapshot = Prisma.AgencyInvitationCheckoutGetPayload<{
  select: typeof checkoutSnapshotSelect
}>

export async function createStripeAgencyInvitationCheckout(
  input: CreateAgencyInvitationCheckoutInput,
): Promise<{ checkoutUrl: string; checkoutId: string }> {
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
    if (existing.status === 'FINALIZED' || existing.stripeSubscriptionId) {
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
    } else if (existing.checkoutExpiresAt.getTime() > Date.now()) {
      // Stripe may have accepted the request even if saving its ID failed.
      // Until expiry, this attempt's snapshot and key must never be replaced.
      if (!existing.checkoutRedirectFingerprint) {
        throw new Error('STRIPE_INVITATION_CHECKOUT_PENDING')
      }
      if (existing.checkoutRedirectFingerprint !== redirectFingerprint) {
        throw new Error('STRIPE_INVITATION_REDIRECT_MISMATCH')
      }
      local = existing
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
    }
    if (existing) {
      // A retrieved expired session or elapsed recorded expiry proves this is
      // a new attempt. Only then may new input replace the persisted snapshot.
      local = await prisma.agencyInvitationCheckout.update({
        where: { id: existing.id },
        data: {
          ...pendingData,
          attemptNumber: { increment: 1 },
          stripeCheckoutSessionId: null,
        },
        select: checkoutSnapshotSelect,
      })
    } else {
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
    }
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

  await prisma.agencyInvitationCheckout.update({
    where: { id: local.id },
    data: { stripeCheckoutSessionId: checkout.id },
  })

  return { checkoutUrl: checkout.url, checkoutId: local.id }
}
