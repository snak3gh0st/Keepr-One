import type Stripe from 'stripe'
import {
  AGENCY_MONTHLY_PRICE_CENTS,
  INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
  INVITED_AGENCY_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
  type PlatformPlanName,
} from '@/lib/plans'

export type StripePlatformCatalogEntry = {
  productId: string
  priceId: string
  unitAmountCents: number
  currency: 'usd'
}

const DEFAULT_AGENT_PRODUCT_ID = 'prod_V8noDGt2qhW2wq'
const DEFAULT_AGENT_PRICE_ID = 'price_1U8WGcGJWjOaP9iwo460bGLb'
const DEFAULT_AGENCY_PRODUCT_ID = 'prod_V8noF7rVSveGUk'
const DEFAULT_AGENCY_PRICE_ID = 'price_1U8WGdGJWjOaP9iw43Kmiien'
const DEFAULT_INVITED_AGENT_PRODUCT_ID = 'prod_VB4QfhI3X92UjL'
const DEFAULT_INVITED_AGENT_PRICE_ID = 'price_1UAiJ0GJWjOaP9iwDnO3AaXc'
const DEFAULT_INVITED_AGENCY_PRODUCT_ID = 'prod_VB4QtibDILaHe6'
const DEFAULT_INVITED_AGENCY_PRICE_ID = 'price_1UAiI5GJWjOaP9iwpYSiCHI9'

function configuredId(name: string, fallback: string, prefix: string): string {
  const value = process.env[name]?.trim() || fallback
  if (!value.startsWith(prefix)) throw new Error(`${name}_INVALID`)
  return value
}

export function getStripeCatalogEntry(
  plan: PlatformPlanName,
): StripePlatformCatalogEntry | null {
  if (plan === 'AGENT_AGENCY_MEMBER') {
    // The live Stripe catalogue currently has no standalone member product.
    // Fail closed rather than charging the agent or agency price by analogy.
    return null
  }

  if (plan === 'AGENT_INDIVIDUAL') {
    return {
      productId: configuredId('STRIPE_AGENT_PRODUCT_ID', DEFAULT_AGENT_PRODUCT_ID, 'prod_'),
      priceId: configuredId('STRIPE_AGENT_PRICE_ID', DEFAULT_AGENT_PRICE_ID, 'price_'),
      unitAmountCents: INDIVIDUAL_AGENT_MONTHLY_PRICE_CENTS,
      currency: 'usd',
    }
  }

  return {
    productId: configuredId('STRIPE_AGENCY_PRODUCT_ID', DEFAULT_AGENCY_PRODUCT_ID, 'prod_'),
    priceId: configuredId('STRIPE_AGENCY_PRICE_ID', DEFAULT_AGENCY_PRICE_ID, 'price_'),
    unitAmountCents: AGENCY_MONTHLY_PRICE_CENTS,
    currency: 'usd',
  }
}

export function getStripeInvitationCatalogEntry(
  plan: Extract<PlatformPlanName, 'AGENT_AGENCY_MEMBER' | 'AGENCY'>,
): StripePlatformCatalogEntry {
  if (plan === 'AGENT_AGENCY_MEMBER') {
    return {
      productId: configuredId(
        'STRIPE_INVITED_AGENT_PRODUCT_ID',
        DEFAULT_INVITED_AGENT_PRODUCT_ID,
        'prod_',
      ),
      priceId: configuredId(
        'STRIPE_INVITED_AGENT_PRICE_ID',
        DEFAULT_INVITED_AGENT_PRICE_ID,
        'price_',
      ),
      unitAmountCents: INVITED_AGENT_MONTHLY_PRICE_CENTS,
      currency: 'usd',
    }
  }

  return {
    productId: configuredId(
      'STRIPE_INVITED_AGENCY_PRODUCT_ID',
      DEFAULT_INVITED_AGENCY_PRODUCT_ID,
      'prod_',
    ),
    priceId: configuredId(
      'STRIPE_INVITED_AGENCY_PRICE_ID',
      DEFAULT_INVITED_AGENCY_PRICE_ID,
      'price_',
    ),
    unitAmountCents: INVITED_AGENCY_MONTHLY_PRICE_CENTS,
    currency: 'usd',
  }
}

export function assertStripePriceMatchesPlan(
  price: Stripe.Price,
  expected: StripePlatformCatalogEntry,
): void {
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
    throw new Error('STRIPE_PRICE_MISMATCH')
  }
}
