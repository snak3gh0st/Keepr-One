import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retrieveCheckout: vi.fn(),
  findCheckout: vi.fn(),
  syncInvitation: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    checkout: { sessions: { retrieve: mocks.retrieveCheckout } },
  }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { agencyInvitationCheckout: { findUnique: mocks.findCheckout } },
}))
vi.mock('@/lib/stripe/agency-invitation-subscription', () => ({
  syncStripeAgencyInvitationSubscription: mocks.syncInvitation,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retrieveCheckout.mockResolvedValue({
    id: 'cs_live_invitation1',
    status: 'complete',
    client_reference_id: 'invite-checkout-1',
    subscription: 'sub_invitation_1',
  })
  mocks.findCheckout.mockResolvedValue({
    id: 'invite-checkout-1',
    email: 'invitee@example.com',
    status: 'FINALIZED',
    stripeCheckoutSessionId: 'cs_live_invitation1',
  })
  mocks.syncInvitation.mockResolvedValue(undefined)
})

describe('agency invitation Checkout completion', () => {
  it('reconciles provider truth and returns the invitee to sign in after finalization', async () => {
    const response = await GET(new Request(
      'https://app.keeprone.com/api/billing/invitation/complete?session_id=cs_live_invitation1',
    ))

    expect(mocks.syncInvitation).toHaveBeenCalledWith('sub_invitation_1')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://app.keeprone.com/login?invitation=accepted&email=invitee%40example.com',
    )
  })

  it('does not reconcile a Checkout session mapped to another local handoff', async () => {
    mocks.findCheckout.mockResolvedValue({
      id: 'another-checkout',
      email: 'other@example.com',
      status: 'PENDING',
      stripeCheckoutSessionId: 'cs_live_invitation1',
    })

    const response = await GET(new Request(
      'https://app.keeprone.com/api/billing/invitation/complete?session_id=cs_live_invitation1',
    ))

    expect(mocks.syncInvitation).not.toHaveBeenCalled()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://app.keeprone.com/login?invitation=billing-pending',
    )
  })
})
