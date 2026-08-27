import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  findLocal: vi.fn(),
  updateLocal: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({ subscriptions: { retrieve: mocks.retrieve } }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformSubscription: {
      findUnique: mocks.findLocal,
      update: mocks.updateLocal,
    },
  },
}))

import {
  syncStripePlatformSubscription,
  toPlatformSubscriptionStatus,
} from './platform-subscription'

const providerSubscription = {
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  metadata: { keeprOnePlatformSubscriptionId: 'local-sub-1' },
  cancel_at_period_end: false,
  canceled_at: null,
  items: {
    data: [{
      current_period_start: 1_787_710_120,
      current_period_end: 1_790_388_120,
      price: {
        id: 'price_1U8WGcGJWjOaP9iwo460bGLb',
        active: true,
        livemode: true,
        product: 'prod_V8noDGt2qhW2wq',
        currency: 'usd',
        unit_amount: 5_990,
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      },
    }],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retrieve.mockResolvedValue(providerSubscription)
  mocks.findLocal.mockResolvedValue({
    id: 'local-sub-1', plan: 'AGENT_INDIVIDUAL', stripeSubscriptionId: null,
  })
  mocks.updateLocal.mockResolvedValue({})
})

describe('Stripe tenant subscription reconciliation', () => {
  it('maps Stripe lifecycle states without granting access to incomplete payment', () => {
    expect(toPlatformSubscriptionStatus('trialing')).toBe('TRIALING')
    expect(toPlatformSubscriptionStatus('active')).toBe('ACTIVE')
    expect(toPlatformSubscriptionStatus('past_due')).toBe('PAST_DUE')
    expect(toPlatformSubscriptionStatus('incomplete')).toBe('PAST_DUE')
    expect(toPlatformSubscriptionStatus('canceled')).toBe('CANCELED')
    expect(toPlatformSubscriptionStatus('incomplete_expired')).toBe('EXPIRED')
  })

  it('links the exact Stripe customer, product, price and subscription to one local subject', async () => {
    await syncStripePlatformSubscription('sub_1')

    expect(mocks.updateLocal).toHaveBeenCalledWith({
      where: { id: 'local-sub-1' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripeProductId: 'prod_V8noDGt2qhW2wq',
        stripePriceId: 'price_1U8WGcGJWjOaP9iwo460bGLb',
        unitAmountCents: 5_990,
        currency: 'USD',
      }),
    })
  })

  it('refuses to replace a local subject already linked to another Stripe subscription', async () => {
    mocks.findLocal.mockResolvedValue({
      id: 'local-sub-1', plan: 'AGENT_INDIVIDUAL', stripeSubscriptionId: 'sub_other',
    })

    await expect(syncStripePlatformSubscription('sub_1'))
      .rejects.toThrow('STRIPE_SUBSCRIPTION_CONFLICT')
    expect(mocks.updateLocal).not.toHaveBeenCalled()
  })
})
