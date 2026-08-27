import { afterEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import {
  assertStripePriceMatchesPlan,
  getStripeCatalogEntry,
} from './platform-catalog'

afterEach(() => vi.unstubAllEnvs())

describe('Keepr One Stripe catalog', () => {
  it('maps the two live products to the matching commercial plans', () => {
    expect(getStripeCatalogEntry('AGENT_INDIVIDUAL')).toEqual({
      productId: 'prod_V8noDGt2qhW2wq',
      priceId: 'price_1U8WGcGJWjOaP9iwo460bGLb',
      unitAmountCents: 5_990,
      currency: 'usd',
    })
    expect(getStripeCatalogEntry('AGENCY')).toEqual({
      productId: 'prod_V8noF7rVSveGUk',
      priceId: 'price_1U8WGdGJWjOaP9iw43Kmiien',
      unitAmountCents: 9_990,
      currency: 'usd',
    })
  })

  it('does not charge an invited member against a different plan', () => {
    expect(getStripeCatalogEntry('AGENT_AGENCY_MEMBER')).toBeNull()
  })

  it('accepts only the exact active live monthly licensed price', () => {
    const expected = getStripeCatalogEntry('AGENT_INDIVIDUAL')!
    const price = {
      id: expected.priceId,
      active: true,
      livemode: true,
      product: expected.productId,
      currency: 'usd',
      unit_amount: 5_990,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    } as Stripe.Price

    expect(() => assertStripePriceMatchesPlan(price, expected)).not.toThrow()
    expect(() => assertStripePriceMatchesPlan({ ...price, unit_amount: 9_990 }, expected))
      .toThrow('STRIPE_PRICE_MISMATCH')
    expect(() => assertStripePriceMatchesPlan({ ...price, livemode: false }, expected))
      .toThrow('STRIPE_PRICE_MISMATCH')
  })

  it('rejects malformed environment overrides before calling Stripe', () => {
    vi.stubEnv('STRIPE_AGENT_PRICE_ID', 'prod_wrong_kind')
    expect(() => getStripeCatalogEntry('AGENT_INDIVIDUAL'))
      .toThrow('STRIPE_AGENT_PRICE_ID_INVALID')
  })
})
