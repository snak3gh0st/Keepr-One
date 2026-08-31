import { NextResponse } from 'next/server'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripeApplicationAddonSubscription } from '@/lib/stripe/application-addon-subscription'

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
    return NextResponse.redirect(new URL('/agent/cases?application_addon=invalid', url), 303)
  }

  try {
    const agent = await getCurrentAgent()
    const checkout = await getStripeClient().checkout.sessions.retrieve(checkoutSessionId)
    const localId = checkout.metadata?.keeprOnePlatformAddonSubscriptionId
    if (checkout.status !== 'complete' || !localId) throw new Error('CHECKOUT_NOT_COMPLETE')

    const local = await prisma.platformAddonSubscription.findFirst({
      where: { id: localId, agentId: agent.id, addon: 'K_BOT_APPLICATION' },
      select: { id: true },
    })
    if (!local || checkout.client_reference_id !== local.id) {
      throw new Error('CHECKOUT_TENANT_MISMATCH')
    }
    const stripeSubscriptionId = subscriptionId(checkout.subscription)
    if (!stripeSubscriptionId) throw new Error('CHECKOUT_SUBSCRIPTION_MISSING')

    await syncStripeApplicationAddonSubscription(stripeSubscriptionId)
    return NextResponse.redirect(new URL('/agent/cases?application_addon=active', url), 303)
  } catch (error) {
    console.error('K-Bot Application checkout completion failed', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.redirect(new URL('/agent/cases?application_addon=pending', url), 303)
  }
}
