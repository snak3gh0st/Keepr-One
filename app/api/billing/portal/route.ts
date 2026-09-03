import { NextResponse } from 'next/server'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { getStripeClient } from '@/lib/stripe/client'

export const runtime = 'nodejs'

function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
  return configured ? configured.replace(/\/$/, '') : new URL(request.url).origin
}

export async function POST(request: Request) {
  try {
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

    const access = await resolveFounderAccessForAgent(agent.id)
    if (access.state === 'LEGACY' || !access.subscription) {
      return NextResponse.json({ error: 'SUBSCRIPTION_NOT_ELIGIBLE' }, { status: 409 })
    }

    const subscription = await prisma.platformSubscription.findUnique({
      where: { id: access.subscription.id },
      select: { stripeCustomerId: true, stripeSubscriptionId: true },
    })
    if (!subscription?.stripeCustomerId || !subscription.stripeSubscriptionId) {
      return NextResponse.json({ error: 'BILLING_PORTAL_UNAVAILABLE' }, { status: 409 })
    }

    const portal = await getStripeClient().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${appOrigin(request)}/founders/expired`,
    })
    return NextResponse.redirect(portal.url, 303)
  } catch (error) {
    console.error('Stripe billing portal creation failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.json({ error: 'BILLING_PORTAL_UNAVAILABLE' }, { status: 503 })
  }
}
