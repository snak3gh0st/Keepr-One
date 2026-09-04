import { NextResponse } from 'next/server'
import { getStripeClient } from '@/lib/stripe/client'
import { syncStripePlatformSubscription } from '@/lib/stripe/platform-subscription'
import { syncStripeApplicationAddonSubscription } from '@/lib/stripe/application-addon-subscription'
import { syncStripeAgencyInvitationSubscription } from '@/lib/stripe/agency-invitation-subscription'
import { grantPaidFollowupInvoice, syncFollowupSubscription } from '@/lib/kbot-followup/billing'

export const runtime = 'nodejs'

function subscriptionIdFromCheckout(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

async function syncSubscription(stripeSubscriptionId: string): Promise<void> {
  const subscription = await getStripeClient().subscriptions.retrieve(stripeSubscriptionId)
  if (subscription.metadata.keeprOneAddon === 'K_BOT_FOLLOWUP') {
    await syncFollowupSubscription(stripeSubscriptionId)
    return
  }
  if (subscription.metadata.keeprOnePlatformAddonSubscriptionId) {
    await syncStripeApplicationAddonSubscription(stripeSubscriptionId)
    return
  }
  if (subscription.metadata.keeprOneAgencyInvitationCheckoutId) {
    await syncStripeAgencyInvitationSubscription(stripeSubscriptionId)
    return
  }
  await syncStripePlatformSubscription(stripeSubscriptionId)
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'WEBHOOK_NOT_CONFIGURED' }, { status: 503 })
  }

  let event
  try {
    event = getStripeClient().webhooks.constructEvent(
      await request.text(),
      signature,
      webhookSecret,
    )
  } catch {
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 400 })
  }

  try {
    if (event.type === 'invoice.paid') {
      await grantPaidFollowupInvoice(event.data.object.id)
    } else if (event.type === 'checkout.session.completed') {
      const subscriptionId = subscriptionIdFromCheckout(event.data.object.subscription)
      if (subscriptionId) await syncSubscription(subscriptionId)
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.paused' ||
      event.type === 'customer.subscription.resumed'
    ) {
      await syncSubscription(event.data.object.id)
    }
  } catch (error) {
    console.error('Stripe subscription webhook failed', {
      eventId: event.id,
      eventType: event.type,
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return NextResponse.json({ error: 'WEBHOOK_RETRY_REQUIRED' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
