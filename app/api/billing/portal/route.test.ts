import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
  resolveAccess: vi.fn(),
  findSubscription: vi.fn(),
  createPortal: vi.fn(),
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
    platformSubscription: { findUnique: mocks.findSubscription },
  },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    billingPortal: { sessions: { create: mocks.createPortal } },
  }),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({
    user: { id: 'user-1' },
    session: { id: 'session-1', impersonatedBy: null },
  })
  mocks.findAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.resolveAccess.mockResolvedValue({
    state: 'EXPIRED',
    subscription: { id: 'local-sub-1' },
  })
  mocks.findSubscription.mockResolvedValue({
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
  })
  mocks.createPortal.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/test' })
})

describe('Stripe billing portal', () => {
  it('opens the portal only for the authenticated agent subscription', async () => {
    const response = await POST(new Request('https://app.keeprone.com/api/billing/portal', {
      method: 'POST',
    }))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://billing.stripe.com/p/session/test')
    expect(mocks.createPortal).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app.keeprone.com/founders/expired',
    })
  })

  it('does not open a portal for an unlinked local subscription', async () => {
    mocks.findSubscription.mockResolvedValue({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })

    const response = await POST(new Request('https://app.keeprone.com/api/billing/portal', {
      method: 'POST',
    }))

    expect(response.status).toBe(409)
    expect(mocks.createPortal).not.toHaveBeenCalled()
  })

  it('does not expose billing from a read-only support preview', async () => {
    mocks.requireRole.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'preview-session', impersonatedBy: 'admin-1' },
    })

    const response = await POST(new Request('https://app.keeprone.com/api/billing/portal', {
      method: 'POST',
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'READ_ONLY_USER_PREVIEW' })
    expect(mocks.findAgent).not.toHaveBeenCalled()
    expect(mocks.createPortal).not.toHaveBeenCalled()
  })
})
