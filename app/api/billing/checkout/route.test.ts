import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
  resolveAccess: vi.fn(),
  findSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  retrievePrice: vi.fn(),
  createCheckout: vi.fn(),
  assertPrice: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({
  requireRoleWithoutFounderAccess: mocks.requireRole,
}))
vi.mock('@/lib/founder-access', () => ({
  resolveFounderAccessForAgent: mocks.resolveAccess,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
    platformSubscription: {
      findUnique: mocks.findSubscription,
      update: mocks.updateSubscription,
    },
  },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    prices: { retrieve: mocks.retrievePrice },
    checkout: { sessions: { create: mocks.createCheckout } },
  }),
}))
vi.mock('@/lib/stripe/platform-catalog', () => ({
  getStripeCatalogEntry: () => ({
    productId: 'prod_agent', priceId: 'price_agent', unitAmountCents: 5_990, currency: 'usd',
  }),
  assertStripePriceMatchesPlan: mocks.assertPrice,
}))

import { POST } from './route'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-04T12:05:00.000Z'))
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({
    user: { id: 'user-1', email: 'agent@example.com' },
    session: { id: 'session-1', impersonatedBy: null },
  })
  mocks.findAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.resolveAccess.mockResolvedValue({
    state: 'EXPIRED',
    requiredPlan: 'AGENT_INDIVIDUAL',
    subscription: { id: 'local-sub-1' },
  })
  mocks.findSubscription.mockResolvedValue({
    id: 'local-sub-1', stripeCustomerId: null, stripeSubscriptionId: null,
  })
  mocks.retrievePrice.mockResolvedValue({ id: 'price_agent' })
  mocks.updateSubscription.mockResolvedValue({})
  mocks.createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/test' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Stripe platform checkout', () => {
  it('retries the same logical checkout with identical Stripe parameters and key', async () => {
    const request = () => new Request('https://app.keeprone.com/api/billing/checkout', { method: 'POST' })

    expect((await POST(request())).status).toBe(303)
    vi.advanceTimersByTime(1_000)
    expect((await POST(request())).status).toBe(303)

    expect(mocks.createCheckout).toHaveBeenCalledTimes(2)
    const [firstParams, firstOptions] = mocks.createCheckout.mock.calls[0]!
    const [secondParams, secondOptions] = mocks.createCheckout.mock.calls[1]!
    expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(secondParams).toEqual(firstParams)
  })

  it('creates a tenant-bound subscription Checkout without hardcoded payment methods', async () => {
    const response = await POST(new Request('https://app.keeprone.com/api/billing/checkout', {
      method: 'POST',
    }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/c/pay/test')
    const [params] = mocks.createCheckout.mock.calls[0]!
    expect(params).toMatchObject({
      mode: 'subscription',
      client_reference_id: 'local-sub-1',
      customer_email: 'agent@example.com',
      line_items: [{ price: 'price_agent', quantity: 1 }],
      metadata: {
        keeprOnePlatformSubscriptionId: 'local-sub-1',
        keeprOneAgentId: 'agent-1',
      },
      subscription_data: {
        metadata: {
          keeprOnePlatformSubscriptionId: 'local-sub-1',
          keeprOneAgentId: 'agent-1',
        },
      },
    })
    expect(params).not.toHaveProperty('payment_method_types')
    expect(params).not.toHaveProperty('integration_identifier')
  })

  it('refuses to create a second Checkout for an already linked subscription', async () => {
    mocks.findSubscription.mockResolvedValue({
      id: 'local-sub-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    })
    const response = await POST(new Request('https://app.keeprone.com/api/billing/checkout', {
      method: 'POST',
    }))

    expect(response.status).toBe(409)
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })

  it('does not initiate billing from a read-only support preview', async () => {
    mocks.requireRole.mockResolvedValue({
      user: { id: 'user-1', email: 'agent@example.com' },
      session: { id: 'preview-session', impersonatedBy: 'admin-1' },
    })

    const response = await POST(new Request('https://app.keeprone.com/api/billing/checkout', {
      method: 'POST',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'READ_ONLY_USER_PREVIEW' })
    expect(mocks.findAgent).not.toHaveBeenCalled()
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })
})
