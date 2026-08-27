import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
  resolveAccess: vi.fn(),
  retrieveCheckout: vi.fn(),
  syncSubscription: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({
  requireRoleWithoutFounderAccess: mocks.requireRole,
}))
vi.mock('@/lib/founder-access', () => ({
  resolveFounderAccessForAgent: mocks.resolveAccess,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { agent: { findUnique: mocks.findAgent } },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { retrieve: mocks.retrieveCheckout } },
  }),
}))
vi.mock('@/lib/stripe/platform-subscription', () => ({
  syncStripePlatformSubscription: mocks.syncSubscription,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.findAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.resolveAccess.mockResolvedValue({ subscription: { id: 'local-sub-1' } })
  mocks.retrieveCheckout.mockResolvedValue({
    status: 'complete',
    client_reference_id: 'local-sub-1',
    subscription: 'sub_1',
  })
  mocks.syncSubscription.mockResolvedValue(undefined)
})

describe('Stripe Checkout completion', () => {
  it('reconciles provider truth before returning the tenant to the app', async () => {
    const response = await GET(new Request(
      'https://app.keeprone.com/api/billing/complete?session_id=cs_live_abc123',
    ))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://app.keeprone.com/agent?billing=active')
    expect(mocks.syncSubscription).toHaveBeenCalledWith('sub_1')
  })

  it('does not attach another tenant checkout session', async () => {
    mocks.retrieveCheckout.mockResolvedValue({
      status: 'complete',
      client_reference_id: 'another-subscription',
      subscription: 'sub_other',
    })
    const response = await GET(new Request(
      'https://app.keeprone.com/api/billing/complete?session_id=cs_live_abc123',
    ))

    expect(response.headers.get('location')).toBe(
      'https://app.keeprone.com/founders/expired?billing=pending',
    )
    expect(mocks.syncSubscription).not.toHaveBeenCalled()
  })
})
