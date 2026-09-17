import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
  resolveAccess: vi.fn(),
  findSubscription: vi.fn(),
  findAudit: vi.fn(),
  createAudit: vi.fn(),
  retrieveCoupon: vi.fn(),
  updateSubscription: vi.fn(),
  syncSubscription: vi.fn(),
  assertSameOrigin: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({
  requireRoleWithoutFounderAccess: mocks.requireRole,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
    platformSubscription: { findUnique: mocks.findSubscription },
    auditLog: { findFirst: mocks.findAudit, create: mocks.createAudit },
  },
}))
vi.mock('@/lib/founder-access', () => ({
  resolveFounderAccessForAgent: mocks.resolveAccess,
}))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.assertSameOrigin,
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    coupons: { retrieve: mocks.retrieveCoupon },
    subscriptions: { update: mocks.updateSubscription },
  }),
}))
vi.mock('@/lib/stripe/platform-subscription', () => ({
  syncStripePlatformSubscription: mocks.syncSubscription,
}))

import { POST } from './route'

const ORIGINAL_COUPON = process.env.STRIPE_RETENTION_COUPON_ID

function request() {
  return new Request('http://localhost:3000/api/billing/retention/accept', { method: 'POST' })
}

function cancellingAccess() {
  return {
    state: 'PAID',
    trialEndsAt: null,
    subscription: {
      id: 'sub-local-1',
      plan: 'AGENT_INDIVIDUAL',
      status: 'ACTIVE',
      unitAmountCents: 5_990,
      currency: 'usd',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_RETENTION_COUPON_ID = 'cRpr4WxG'
  mocks.requireRole.mockResolvedValue({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  })
  mocks.findAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.resolveAccess.mockResolvedValue(cancellingAccess())
  mocks.findSubscription.mockResolvedValue({ id: 'sub-local-1', stripeSubscriptionId: 'sub_stripe_1' })
  mocks.findAudit.mockResolvedValue(null)
  mocks.createAudit.mockResolvedValue({ id: 'audit-1' })
  mocks.retrieveCoupon.mockResolvedValue({
    id: 'cRpr4WxG',
    valid: true,
    percent_off: 50,
    duration: 'repeating',
    duration_in_months: 3,
    redeem_by: null,
  })
  mocks.updateSubscription.mockResolvedValue({ id: 'sub_stripe_1' })
  mocks.syncSubscription.mockResolvedValue(undefined)
})

afterEach(() => {
  if (ORIGINAL_COUPON === undefined) delete process.env.STRIPE_RETENTION_COUPON_ID
  else process.env.STRIPE_RETENTION_COUPON_ID = ORIGINAL_COUPON
})

describe('POST /api/billing/retention/accept', () => {
  it('clears the cancellation and applies the coupon to the live subscription', async () => {
    const response = await POST(request())

    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      'sub_stripe_1',
      expect.objectContaining({
        cancel_at_period_end: false,
        discounts: [{ coupon: 'cRpr4WxG' }],
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('sub-local-1') }),
    )
    expect(mocks.syncSubscription).toHaveBeenCalledWith('sub_stripe_1')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/agent?billing=retained')
  })

  it('records the acceptance so the discount cannot be taken twice', async () => {
    await POST(request())

    expect(mocks.createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'BILLING_RETENTION_OFFER_GRANTED',
        entity: 'PlatformSubscription',
        entityId: 'sub-local-1',
      }),
    })
  })

  it('refuses a second discount to a subscription that already had one', async () => {
    mocks.findAudit.mockResolvedValue({ id: 'earlier-grant' })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'ALREADY_GRANTED' })
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('refuses an account that is paying full price and not cancelling', async () => {
    const access = cancellingAccess()
    access.subscription.cancelAtPeriodEnd = false
    mocks.resolveAccess.mockResolvedValue(access)

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'ALREADY_PAID' })
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('sends an account without a live Stripe subscription to the checkout path instead', async () => {
    mocks.findSubscription.mockResolvedValue({ id: 'sub-local-1', stripeSubscriptionId: null })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'SUBSCRIPTION_NOT_LINKED' })
  })

  it('does nothing when the offer is switched off', async () => {
    delete process.env.STRIPE_RETENTION_COUPON_ID

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'OFFER_UNAVAILABLE' })
    expect(mocks.retrieveCoupon).not.toHaveBeenCalled()
  })

  it('never charges through a support preview', async () => {
    mocks.requireRole.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'preview', impersonatedBy: 'admin-1' },
    })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('refuses a coupon Stripe no longer considers usable', async () => {
    mocks.retrieveCoupon.mockResolvedValue({
      id: 'cRpr4WxG',
      valid: false,
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 3,
      redeem_by: null,
    })

    const response = await POST(request())

    expect(response.status).toBe(503)
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('keeps the subscription retained even when the audit write fails', async () => {
    mocks.createAudit.mockRejectedValue(new Error('audit down'))

    const response = await POST(request())

    expect(mocks.updateSubscription).toHaveBeenCalled()
    expect(response.status).toBe(303)
  })
})
