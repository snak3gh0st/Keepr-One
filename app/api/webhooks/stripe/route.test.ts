import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  syncSubscription: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: mocks.constructEvent },
  }),
}))
vi.mock('@/lib/stripe/platform-subscription', () => ({
  syncStripePlatformSubscription: mocks.syncSubscription,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

describe('Stripe subscription webhook', () => {
  it('rejects an invalid signature before touching tenant state', async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error('bad signature') })
    const response = await POST(new Request('https://app.keeprone.com/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'forged' },
      body: '{}',
    }))

    expect(response.status).toBe(400)
    expect(mocks.syncSubscription).not.toHaveBeenCalled()
  })

  it('retrieves provider truth for a completed subscription Checkout', async () => {
    mocks.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub_1' } },
    })
    mocks.syncSubscription.mockResolvedValue(undefined)
    const response = await POST(new Request('https://app.keeprone.com/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid' },
      body: '{}',
    }))

    expect(response.status).toBe(200)
    expect(mocks.syncSubscription).toHaveBeenCalledWith('sub_1')
  })
})
