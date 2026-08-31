import { describe, expect, it } from 'vitest'
import type Stripe from 'stripe'
import {
  assertKBotApplicationPrice,
  getKBotApplicationCatalog,
} from './application-addon-catalog'

describe('K-Bot Application Stripe catalog', () => {
  it('uses the live symbolic monthly price and 14-day trial', () => {
    expect(getKBotApplicationCatalog()).toEqual({
      productId: 'prod_VAdcDhsg3cIDLa',
      priceId: 'price_1UAILRGJWjOaP9iw7U9oIyes',
      unitAmountCents: 1_299,
      currency: 'usd',
      trialDays: 14,
    })
  })

  it('fails closed when provider price truth drifts', () => {
    const expected = getKBotApplicationCatalog()
    const price = {
      id: expected.priceId,
      active: true,
      livemode: true,
      product: expected.productId,
      currency: expected.currency,
      unit_amount: expected.unitAmountCents,
      recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    } as Stripe.Price
    expect(() => assertKBotApplicationPrice(price)).not.toThrow()
    expect(() => assertKBotApplicationPrice({ ...price, unit_amount: 1_999 } as Stripe.Price))
      .toThrow('STRIPE_KBOT_APPLICATION_PRICE_MISMATCH')
  })
})
