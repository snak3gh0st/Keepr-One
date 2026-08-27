import { NextResponse } from 'next/server'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripePlatformSubscription } from '@/lib/stripe/platform-subscription'

export const runtime = 'nodejs'

function subscriptionId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
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
    return NextResponse.redirect(new URL('/agent?billing=active', url), 303)
  } catch (error) {
    console.error('Stripe checkout completion failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.redirect(new URL('/founders/expired?billing=pending', url), 303)
  }
}
