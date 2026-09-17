import type Stripe from 'stripe'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertUsableRetentionCoupon,
  checkoutIdempotencyKey,
  getConfiguredRetentionCouponId,
} from './retention-offer'

const ORIGINAL = process.env.STRIPE_RETENTION_COUPON_ID

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.STRIPE_RETENTION_COUPON_ID
  else process.env.STRIPE_RETENTION_COUPON_ID = ORIGINAL
})

function coupon(overrides: Partial<Stripe.Coupon> = {}): Stripe.Coupon {
  return {
    id: 'cRpr4WxG',
    valid: true,
    percent_off: 50,
    amount_off: null,
    duration: 'repeating',
    duration_in_months: 3,
    redeem_by: null,
    ...overrides,
  } as Stripe.Coupon
}

describe('getConfiguredRetentionCouponId', () => {
  it('treats an unset variable as the offer being switched off', () => {
    delete process.env.STRIPE_RETENTION_COUPON_ID
    expect(getConfiguredRetentionCouponId()).toBeNull()

    process.env.STRIPE_RETENTION_COUPON_ID = '   '
    expect(getConfiguredRetentionCouponId()).toBeNull()
  })

  it('reports a malformed value instead of silently disabling the offer', () => {
    process.env.STRIPE_RETENTION_COUPON_ID = 'two words'
    expect(() => getConfiguredRetentionCouponId()).toThrow('STRIPE_RETENTION_COUPON_ID_INVALID')
  })

  it('returns the trimmed coupon id', () => {
    process.env.STRIPE_RETENTION_COUPON_ID = '  cRpr4WxG  '
    expect(getConfiguredRetentionCouponId()).toBe('cRpr4WxG')
  })
})

describe('assertUsableRetentionCoupon', () => {
  it('accepts the configured percentage coupon', () => {
    expect(assertUsableRetentionCoupon(coupon(), 'cRpr4WxG')).toEqual({
      couponId: 'cRpr4WxG',
      percentOff: 50,
      durationInMonths: 3,
      duration: 'repeating',
    })
  })

  it('refuses a coupon that is not the configured one', () => {
    expect(() => assertUsableRetentionCoupon(coupon({ id: 'other' }), 'cRpr4WxG'))
      .toThrow('STRIPE_RETENTION_COUPON_UNUSABLE')
  })

  it.each([
    ['invalidated', { valid: false }],
    ['fixed-amount', { percent_off: null, amount_off: 500 }],
    ['zero percent', { percent_off: 0 }],
    ['full discount', { percent_off: 100 }],
    ['repeating without a month count', { duration_in_months: null }],
  ])('refuses a %s coupon', (_label, overrides) => {
    expect(() => assertUsableRetentionCoupon(coupon(overrides as Partial<Stripe.Coupon>), 'cRpr4WxG'))
      .toThrow('STRIPE_RETENTION_COUPON_UNUSABLE')
  })

  it('refuses a coupon whose redemption window already closed', () => {
    const past = Math.floor((Date.now() - 60_000) / 1_000)
    expect(() => assertUsableRetentionCoupon(coupon({ redeem_by: past }), 'cRpr4WxG'))
      .toThrow('STRIPE_RETENTION_COUPON_UNUSABLE')
  })

  it('accepts a forever coupon, which carries no month count', () => {
    const offer = assertUsableRetentionCoupon(
      coupon({ duration: 'forever', duration_in_months: null }),
      'cRpr4WxG',
    )
    expect(offer.durationInMonths).toBeNull()
  })
})

describe('checkoutIdempotencyKey', () => {
  it('separates a discounted attempt from a full-price one in the same window', () => {
    const now = 1_760_000_000_000
    expect(checkoutIdempotencyKey('sub-1', null, now))
      .not.toBe(checkoutIdempotencyKey('sub-1', 'CANCEL_RETENTION', now))
  })

  it('separates the two discount reasons from each other', () => {
    const now = 1_760_000_000_000
    expect(checkoutIdempotencyKey('sub-1', 'TRIAL_CONVERSION', now))
      .not.toBe(checkoutIdempotencyKey('sub-1', 'CANCEL_RETENTION', now))
  })

  it('still collapses repeated identical attempts inside the same window', () => {
    const now = 1_760_000_000_000
    expect(checkoutIdempotencyKey('sub-1', 'CANCEL_RETENTION', now))
      .toBe(checkoutIdempotencyKey('sub-1', 'CANCEL_RETENTION', now + 60_000))
  })
})
