import 'server-only'

import Stripe from 'stripe'

let stripeClient: Stripe | null = null

export function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient

  const apiKey = process.env.STRIPE_API_KEY?.trim()
    || process.env.STRIPE_SECRET_KEY?.trim()
  if (!apiKey) throw new Error('STRIPE_API_KEY_MISSING')

  stripeClient = new Stripe(apiKey, {
    apiVersion: '2026-07-29.dahlia',
    appInfo: { name: 'Keepr One', version: '0.1.0' },
  })
  return stripeClient
}
