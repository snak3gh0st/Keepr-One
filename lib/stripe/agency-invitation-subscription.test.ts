import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  findCheckout: vi.fn(),
  finalizeAccess: vi.fn(),
  updateSubscription: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: mocks.retrieveSubscription },
  }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agencyInvitationCheckout: { findUnique: mocks.findCheckout },
    platformSubscription: { update: mocks.updateSubscription },
  },
}))
vi.mock('@/lib/agency-invitation-finalization', () => ({
  finalizeAgencyInvitationAccess: mocks.finalizeAccess,
}))

import { syncStripeAgencyInvitationSubscription } from './agency-invitation-subscription'

const providerSubscription = {
  id: 'sub_invitation_1',
  status: 'active',
  customer: 'cus_invitation_1',
  metadata: {
    keeprOneAgencyInvitationCheckoutId: 'invite-checkout-1',
    keeprOneAgencyInvitationId: 'invitation-1',
    keeprOneInvitationPlan: 'AGENT_AGENCY_MEMBER',
  },
  cancel_at_period_end: false,
  canceled_at: null,
  items: {
    data: [{
      current_period_start: 1_788_220_200,
      current_period_end: 1_790_812_200,
      price: {
        id: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
        active: true,
        livemode: true,
        product: 'prod_VB4QfhI3X92UjL',
        currency: 'usd',
        unit_amount: 4_990,
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
      },
    }],
  },
}

const pendingCheckout = {
  id: 'invite-checkout-1',
  invitationId: 'invitation-1',
  email: 'invitee@example.com',
  name: 'Maria Invitee',
  agencyName: null,
  passwordHash: 'argon2-password-hash',
  userId: null,
  plan: 'AGENT_AGENCY_MEMBER',
  status: 'PENDING',
  unitAmountCents: 4_990,
  stripeSubscriptionId: null,
  platformSubscriptionId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retrieveSubscription.mockResolvedValue(providerSubscription)
  mocks.findCheckout.mockResolvedValue(pendingCheckout)
  mocks.finalizeAccess.mockResolvedValue({
    platformSubscriptionId: 'local-subscription-1',
    createdAccount: true,
  })
})

describe('Stripe agency invitation subscription reconciliation', () => {
  it('finalizes access only from exact active provider truth', async () => {
    await syncStripeAgencyInvitationSubscription('sub_invitation_1')

    expect(mocks.finalizeAccess).toHaveBeenCalledWith({
      checkoutId: 'invite-checkout-1',
      invitationId: 'invitation-1',
      expectedUserId: null,
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      plan: 'AGENT_AGENCY_MEMBER',
      unitAmountCents: 4_990,
      provider: {
        status: 'ACTIVE',
        stripeCustomerId: 'cus_invitation_1',
        stripeSubscriptionId: 'sub_invitation_1',
        stripeProductId: 'prod_VB4QfhI3X92UjL',
        stripePriceId: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
        currentPeriodStart: new Date(1_788_220_200_000),
        currentPeriodEnd: new Date(1_790_812_200_000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    })
  })

  it('rejects a provider price that does not match the invited plan', async () => {
    mocks.retrieveSubscription.mockResolvedValue({
      ...providerSubscription,
      items: {
        data: [{
          ...providerSubscription.items.data[0],
          price: { ...providerSubscription.items.data[0].price, unit_amount: 3_990 },
        }],
      },
    })

    await expect(syncStripeAgencyInvitationSubscription('sub_invitation_1'))
      .rejects.toThrow('STRIPE_PRICE_MISMATCH')
    expect(mocks.finalizeAccess).not.toHaveBeenCalled()
  })

  it('reconciles an already finalized invitation without creating the account twice', async () => {
    mocks.findCheckout.mockResolvedValue({
      ...pendingCheckout,
      status: 'FINALIZED',
      userId: 'user-1',
      stripeSubscriptionId: 'sub_invitation_1',
      platformSubscriptionId: 'local-subscription-1',
    })

    await syncStripeAgencyInvitationSubscription('sub_invitation_1')

    expect(mocks.finalizeAccess).not.toHaveBeenCalled()
    expect(mocks.updateSubscription).toHaveBeenCalledWith({
      where: { id: 'local-subscription-1' },
      data: expect.objectContaining({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_invitation_1',
        unitAmountCents: 4_990,
      }),
    })
  })
})
