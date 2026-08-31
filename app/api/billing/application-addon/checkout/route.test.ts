import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  findUser: vi.fn(),
  executeRaw: vi.fn(),
  findBase: vi.fn(),
  findAddon: vi.fn(),
  createAddon: vi.fn(),
  updateAddon: vi.fn(),
  retrievePrice: vi.fn(),
  createCheckout: vi.fn(),
  assertPrice: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getAgent }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    $executeRaw: mocks.executeRaw,
    platformSubscription: { findFirst: mocks.findBase },
    platformAddonSubscription: {
      findFirst: mocks.findAddon,
      create: mocks.createAddon,
      update: mocks.updateAddon,
    },
  }
  return {
    prisma: {
      user: { findUnique: mocks.findUser },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    },
  }
})
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    prices: { retrieve: mocks.retrievePrice },
    checkout: { sessions: { create: mocks.createCheckout } },
  }),
}))
vi.mock('@/lib/stripe/application-addon-catalog', () => ({
  getKBotApplicationCatalog: () => ({
    productId: 'prod_addon', priceId: 'price_addon', unitAmountCents: 1_299,
    currency: 'usd', trialDays: 14,
  }),
  assertKBotApplicationPrice: mocks.assertPrice,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findUser.mockResolvedValue({ email: 'agent@example.com' })
  mocks.findBase.mockResolvedValue({ stripeCustomerId: 'cus_existing' })
  mocks.findAddon.mockResolvedValue(null)
  mocks.createAddon.mockImplementation(async ({ data }) => ({ id: 'addon-1', ...data }))
  mocks.retrievePrice.mockResolvedValue({ id: 'price_addon' })
  mocks.createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/addon' })
})

describe('K-Bot Application checkout', () => {
  it('creates one tenant-bound 14-day trial without granting access before Stripe confirms it', async () => {
    const response = await POST(new Request(
      'https://app.keeprone.com/api/billing/application-addon/checkout',
      { method: 'POST' },
    ))

    expect(response.status).toBe(303)
    expect(mocks.createAddon).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-1',
        addon: 'K_BOT_APPLICATION',
        status: 'PAST_DUE',
        stripeCustomerId: 'cus_existing',
      }),
    })
    const [params] = mocks.createCheckout.mock.calls[0]!
    expect(params).toMatchObject({
      mode: 'subscription',
      client_reference_id: 'addon-1',
      customer: 'cus_existing',
      line_items: [{ price: 'price_addon', quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          keeprOnePlatformAddonSubscriptionId: 'addon-1',
          keeprOneAddon: 'K_BOT_APPLICATION',
          keeprOneAgentId: 'agent-1',
        },
      },
    })
    expect(params).not.toHaveProperty('payment_method_types')
  })

  it('refuses a second Checkout after the add-on is linked', async () => {
    mocks.findAddon.mockResolvedValue({
      id: 'addon-1', stripeSubscriptionId: 'sub_1', stripeCustomerId: 'cus_existing',
    })

    const response = await POST(new Request(
      'https://app.keeprone.com/api/billing/application-addon/checkout',
      { method: 'POST' },
    ))

    expect(response.status).toBe(409)
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })
})
