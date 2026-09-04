import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ agent: vi.fn(), findAddon: vi.fn(), createAddon: vi.fn(), updateAddon: vi.fn(), create: vi.fn(), retrieve: vi.fn(), price: vi.fn() }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.agent }))
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => ({ prices: { retrieve: mocks.price }, checkout: { sessions: { create: mocks.create, retrieve: mocks.retrieve } } }) }))
vi.mock('@/lib/prisma', () => {
  const tx = { $executeRaw: vi.fn(), platformSubscription: { findFirst: async () => ({ stripeCustomerId: 'cus_agent' }) },
    platformAddonSubscription: { findFirst: mocks.findAddon, create: mocks.createAddon, update: mocks.updateAddon } }
  return { prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    user: { findUniqueOrThrow: async () => ({ email: 'agent@example.invalid' }) }, platformAddonSubscription: { updateMany: vi.fn() } } }
})
import { POST } from './route'
const request = (origin = 'https://app.keeprone.com') => new Request('https://app.keeprone.com/api/billing/followup-addon/checkout', {
  method: 'POST', headers: { origin, host: 'app.keeprone.com' },
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('KBOT_FOLLOWUP_ENABLED', 'true'); vi.stubEnv('STRIPE_KBOT_FOLLOWUP_PRODUCT_ID', 'prod_test'); vi.stubEnv('STRIPE_KBOT_FOLLOWUP_PRICE_ID', 'price_test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.keeprone.com')
  mocks.agent.mockResolvedValue({ id: 'agent', userId: 'user' })
  mocks.findAddon.mockResolvedValue(null)
  mocks.createAddon.mockImplementation(async ({ data }) => ({ id: 'addon', ...data }))
  mocks.price.mockResolvedValue({ id: 'price_test', product: 'prod_test', active: true, currency: 'usd', unit_amount: 900,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } })
  mocks.create.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' })
})
afterEach(() => vi.unstubAllEnvs())
describe('follow-up checkout boundaries', () => {
  it('uses the signed-in agent and a monthly token allowance, without a trial', async () => {
    expect((await POST(request())).status).toBe(303)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ customer: 'cus_agent', client_reference_id: 'addon',
      subscription_data: { metadata: { keeprOneAgentId: 'agent', keeprOneFollowupTokens: '100000' } }, line_items: [{ price: 'price_test', quantity: 1 }] })
    expect(mocks.create.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days')
  })
  it('reuses the same idempotency key after a lost Stripe response', async () => {
    mocks.createAddon.mockImplementation(async ({ data }) => {
      const local = { id: 'addon', ...data }
      mocks.findAddon.mockResolvedValue(local)
      return local
    })
    mocks.create.mockRejectedValueOnce(new Error('connection reset'))
    expect((await POST(request())).status).toBe(503)
    expect((await POST(request())).status).toBe(303)
    expect(mocks.create.mock.calls[0]).toEqual(mocks.create.mock.calls[1])
    expect(mocks.createAddon).toHaveBeenCalledTimes(1)
  })
  it('reopens an existing session without creating another', async () => {
    mocks.findAddon.mockResolvedValue({ id: 'addon', stripeCheckoutSessionId: 'cs_test', checkoutExpiresAt: new Date(Date.now() + 3_600_000) })
    mocks.retrieve.mockResolvedValue({ status: 'open', url: 'https://checkout.stripe.com/test' })
    expect((await POST(request())).status).toBe(303)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not duplicate a completed checkout while its webhook is pending', async () => {
    mocks.findAddon.mockResolvedValue({ id: 'addon', stripeCheckoutSessionId: 'cs_test', checkoutExpiresAt: new Date(Date.now() - 1_000) })
    mocks.retrieve.mockResolvedValue({ status: 'complete' })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.updateAddon).not.toHaveBeenCalled()
  })
  it('blocks cross-site requests before reading the agent or contacting Stripe', async () => {
    expect((await POST(request('https://other.invalid'))).status).toBe(403)
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.price).not.toHaveBeenCalled()
  })
  it('keeps checkout unavailable without a configured paid catalog', async () => {
    vi.stubEnv('STRIPE_KBOT_FOLLOWUP_PRICE_ID', '')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.createAddon).not.toHaveBeenCalled()
  })
})
