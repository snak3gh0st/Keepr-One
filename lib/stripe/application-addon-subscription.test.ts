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
    platformAddonSubscription: {
      findUnique: mocks.findLocal,
      update: mocks.updateLocal,
    },
  },
}))

import { syncStripeApplicationAddonSubscription } from './application-addon-subscription'

const providerSubscription = {
  id: 'sub_addon_1',
  status: 'trialing',
  customer: 'cus_1',
  metadata: { keeprOnePlatformAddonSubscriptionId: 'local-addon-1' },
  cancel_at_period_end: false,
  canceled_at: null,
  items: {
    data: [{
      current_period_start: 1_787_710_120,
      current_period_end: 1_790_388_120,
      price: {
        id: 'price_1UAILRGJWjOaP9iw7U9oIyes',
        active: true,
        livemode: true,
        product: 'prod_VAdcDhsg3cIDLa',
        currency: 'usd',
        unit_amount: 999,
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      },
    }],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retrieve.mockResolvedValue(providerSubscription)
  mocks.findLocal.mockResolvedValue({
    id: 'local-addon-1', addon: 'K_BOT_APPLICATION', stripeSubscriptionId: null,
  })
})

describe('K-Bot Application subscription reconciliation', () => {
  it('grants the trial only after reading the exact Stripe subscription', async () => {
    await syncStripeApplicationAddonSubscription('sub_addon_1')

    expect(mocks.updateLocal).toHaveBeenCalledWith({
      where: { id: 'local-addon-1' },
      data: expect.objectContaining({
        status: 'TRIALING',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_addon_1',
        stripeProductId: 'prod_VAdcDhsg3cIDLa',
        stripePriceId: 'price_1UAILRGJWjOaP9iw7U9oIyes',
        unitAmountCents: 999,
        currency: 'USD',
      }),
    })
  })

  it('does not bind a second provider subscription to the same local add-on', async () => {
    mocks.findLocal.mockResolvedValue({
      id: 'local-addon-1', addon: 'K_BOT_APPLICATION', stripeSubscriptionId: 'sub_other',
    })

    await expect(syncStripeApplicationAddonSubscription('sub_addon_1'))
      .rejects.toThrow('STRIPE_ADDON_SUBSCRIPTION_CONFLICT')
    expect(mocks.updateLocal).not.toHaveBeenCalled()
  })
})
