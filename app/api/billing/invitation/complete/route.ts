import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripeAgencyInvitationSubscription } from '@/lib/stripe/agency-invitation-subscription'

export const runtime = 'nodejs'

function subscriptionId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

function pendingRedirect(url: URL): NextResponse {
  return NextResponse.redirect(new URL('/login?invitation=billing-pending', url), 303)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const checkoutSessionId = url.searchParams.get('session_id')
  if (!checkoutSessionId || !/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(checkoutSessionId)) {
    return pendingRedirect(url)
  }

  try {
    const checkout = await getStripeClient().checkout.sessions.retrieve(checkoutSessionId)
    const stripeSubscriptionId = subscriptionId(checkout.subscription)
    if (checkout.status !== 'complete' || !stripeSubscriptionId || !checkout.client_reference_id) {
      throw new Error('INVITATION_CHECKOUT_NOT_COMPLETE')
    }

    const local = await prisma.agencyInvitationCheckout.findUnique({
      where: { stripeCheckoutSessionId: checkout.id },
      select: {
        id: true,
        email: true,
        status: true,
        stripeCheckoutSessionId: true,
      },
    })
    if (!local || local.id !== checkout.client_reference_id) {
      throw new Error('INVITATION_CHECKOUT_TENANT_MISMATCH')
    }

    await syncStripeAgencyInvitationSubscription(stripeSubscriptionId)
    const finalized = await prisma.agencyInvitationCheckout.findUnique({
      where: { id: local.id },
      select: {
        id: true,
        email: true,
        status: true,
        stripeCheckoutSessionId: true,
      },
    })
    if (!finalized || finalized.status !== 'FINALIZED') {
      throw new Error('INVITATION_CHECKOUT_FINALIZATION_PENDING')
    }

    const params = new URLSearchParams({
      invitation: 'accepted',
      email: finalized.email,
    })
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, url), 303)
  } catch (error) {
    console.error('Agency invitation Checkout completion failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return pendingRedirect(url)
  }
}
