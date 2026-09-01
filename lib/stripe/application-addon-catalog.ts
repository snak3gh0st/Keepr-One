import type Stripe from 'stripe'

export const K_BOT_APPLICATION_MONTHLY_CENTS = 1_299
export const K_BOT_APPLICATION_TRIAL_DAYS = 14

const DEFAULT_PRODUCT_ID = 'prod_VAdcDhsg3cIDLa'
const DEFAULT_PRICE_ID = 'price_1UAi6nGJWjOaP9iw9O7Vh6FC'

function configuredId(name: string, fallback: string, prefix: string): string {
  const value = process.env[name]?.trim() || fallback
  if (!value.startsWith(prefix)) throw new Error(`${name}_INVALID`)
  return value
}

export function getKBotApplicationCatalog() {
  return {
    productId: configuredId('STRIPE_KBOT_APPLICATION_PRODUCT_ID', DEFAULT_PRODUCT_ID, 'prod_'),
    priceId: configuredId('STRIPE_KBOT_APPLICATION_PRICE_ID', DEFAULT_PRICE_ID, 'price_'),
    unitAmountCents: K_BOT_APPLICATION_MONTHLY_CENTS,
    currency: 'usd' as const,
    trialDays: K_BOT_APPLICATION_TRIAL_DAYS,
  }
}

export function assertKBotApplicationPrice(price: Stripe.Price): void {
  const expected = getKBotApplicationCatalog()
  const productId = typeof price.product === 'string' ? price.product : price.product.id
  if (
    !price.active ||
    !price.livemode ||
    price.id !== expected.priceId ||
    productId !== expected.productId ||
    price.currency !== expected.currency ||
    price.unit_amount !== expected.unitAmountCents ||
    price.recurring?.interval !== 'month' ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed'
  ) {
    throw new Error('STRIPE_KBOT_APPLICATION_PRICE_MISMATCH')
  }
}
