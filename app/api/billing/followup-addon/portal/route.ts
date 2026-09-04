import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { getStripeClient } from '@/lib/stripe/client'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

export async function POST(request: Request) {
  try {
    assertSameOriginAction({ origin: request.headers.get('origin'), host: request.headers.get('host'),
      forwardedHost: request.headers.get('x-forwarded-host'), forwardedProto: request.headers.get('x-forwarded-proto') })
  } catch { return Response.json({ error: 'FORBIDDEN' }, { status: 403 }) }
  try {
    const session = await requireRoleWithoutFounderAccess('AGENT')
    if (typeof (session.session as { impersonatedBy?: unknown }).impersonatedBy === 'string') return Response.json({ error: 'READ_ONLY_USER_PREVIEW' }, { status: 403 })
    const agent = await prisma.agent.findUniqueOrThrow({ where: { userId: session.user.id }, select: { id: true } })
    const subscription = await prisma.platformAddonSubscription.findFirst({ where: { agentId: agent.id, addon: 'K_BOT_FOLLOWUP', stripeSubscriptionId: { not: null }, stripeCustomerId: { not: null } }, orderBy: { createdAt: 'desc' } })
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
    if (!subscription?.stripeCustomerId || !origin) return Response.json({ error: 'BILLING_PORTAL_UNAVAILABLE' }, { status: 409 })
    const portal = await getStripeClient().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${origin.replace(/\/$/, '')}/agent/kbot` })
    return NextResponse.redirect(portal.url, 303)
  } catch { return Response.json({ error: 'BILLING_PORTAL_UNAVAILABLE' }, { status: 503 }) }
}
