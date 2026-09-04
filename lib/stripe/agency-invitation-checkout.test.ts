import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findCheckout: vi.fn(),
  createLocalCheckout: vi.fn(),
  updateLocalCheckout: vi.fn(),
  transaction: vi.fn(),
  invitationFindUnique: vi.fn(),
  retrievePrice: vi.fn(),
  retrieveCheckout: vi.fn(),
  createCheckout: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    agencyInvitation: { findUnique: mocks.invitationFindUnique },
    agencyInvitationCheckout: {
      findUnique: mocks.findCheckout,
      create: mocks.createLocalCheckout,
      update: mocks.updateLocalCheckout,
    },
  },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    prices: { retrieve: mocks.retrievePrice },
    checkout: { sessions: { create: mocks.createCheckout, retrieve: mocks.retrieveCheckout } },
  }),
}))

import { createStripeAgencyInvitationCheckout } from './agency-invitation-checkout'

function invitationInput() {
  return {
    invitationId: 'invitation-1', invitedEmail: 'invitee@example.com', name: 'Maria Invitee',
    agencyName: null, passwordHash: 'argon2-password-hash', userId: null,
    plan: 'AGENT_AGENCY_MEMBER' as const, inviterRole: 'OWNER' as const, unitAmountCents: 4_990,
    acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
    invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
    origin: 'https://app.keeprone.com', invitationToken: 'a'.repeat(43),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
  mocks.findCheckout.mockResolvedValue(null)
  mocks.invitationFindUnique.mockResolvedValue({
    id: 'invitation-1',
    status: 'PENDING',
    expiresAt: new Date('2026-09-09T12:00:00.000Z'),
  })
  mocks.transaction.mockImplementation(async (callback: (transaction: {
    agencyInvitation: { findUnique: typeof mocks.invitationFindUnique }
    agencyInvitationCheckout: { create: typeof mocks.createLocalCheckout }
  }) => unknown) => callback({
    agencyInvitation: { findUnique: mocks.invitationFindUnique },
    agencyInvitationCheckout: { create: mocks.createLocalCheckout },
  }))
  mocks.createLocalCheckout.mockImplementation(async ({ data }) => ({ id: 'invite-checkout-1', ...data }))
  mocks.retrievePrice.mockResolvedValue({
    id: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
    active: true,
    livemode: true,
    product: 'prod_VB4QfhI3X92UjL',
    currency: 'usd',
    unit_amount: 4_990,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
  })
  mocks.createCheckout.mockResolvedValue({
    id: 'cs_live_invitation_1',
    url: 'https://checkout.stripe.com/c/pay/invitation-1',
  })
  mocks.updateLocalCheckout.mockResolvedValue({})
  mocks.retrieveCheckout.mockResolvedValue({
    id: 'cs_live_existing1',
    status: 'open',
    client_reference_id: 'invite-checkout-1',
    url: 'https://checkout.stripe.com/c/pay/existing-invitation',
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Stripe agency invitation Checkout', () => {
  it.each(['origin', 'invitationToken'] as const)('rejects a changed %s before retrying an uncertain Stripe attempt', async (field) => {
    const input = invitationInput()
    let persisted: Record<string, unknown> | null = null
    mocks.findCheckout.mockImplementation(async () => persisted)
    mocks.createLocalCheckout.mockImplementation(async ({ data }) => {
      persisted = { ...data, id: 'invite-checkout-1', status: 'PENDING', stripeCheckoutSessionId: null }
      return persisted
    })
    mocks.updateLocalCheckout.mockRejectedValueOnce(new Error('SESSION_PERSIST_FAILED'))
    await expect(createStripeAgencyInvitationCheckout(input)).rejects.toThrow('SESSION_PERSIST_FAILED')

    await expect(createStripeAgencyInvitationCheckout({
      ...input,
      [field]: field === 'origin' ? 'https://changed.example.com' : 'b'.repeat(43),
    })).rejects.toThrow('STRIPE_INVITATION_REDIRECT_MISMATCH')
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1)
    expect(mocks.updateLocalCheckout).toHaveBeenCalledTimes(1)
  })

  it('fails closed for a legacy uncertain attempt until its recorded expiry', async () => {
    mocks.findCheckout.mockResolvedValue({
      id: 'invite-checkout-1', status: 'PENDING', attemptNumber: 1,
      stripeCheckoutSessionId: null, stripeSubscriptionId: null,
      checkoutRedirectFingerprint: null,
      checkoutExpiresAt: new Date('2026-09-01T22:30:00.000Z'),
    })
    await expect(createStripeAgencyInvitationCheckout(invitationInput()))
      .rejects.toThrow('STRIPE_INVITATION_CHECKOUT_PENDING')
    expect(mocks.createCheckout).not.toHaveBeenCalled()
    expect(mocks.updateLocalCheckout).not.toHaveBeenCalled()
  })

  it('starts a new fingerprinted attempt only after the legacy recorded expiry', async () => {
    mocks.findCheckout.mockResolvedValue({
      id: 'invite-checkout-1', status: 'PENDING', attemptNumber: 1,
      stripeCheckoutSessionId: null, stripeSubscriptionId: null,
      checkoutRedirectFingerprint: null,
      checkoutExpiresAt: new Date('2026-08-31T23:59:00.000Z'),
    })
    mocks.updateLocalCheckout.mockImplementationOnce(async ({ data }) => ({
      ...data, id: 'invite-checkout-1', attemptNumber: 2,
    }))
    await createStripeAgencyInvitationCheckout(invitationInput())
    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.updateLocalCheckout.mock.calls[0]![0].data).toMatchObject({
      attemptNumber: { increment: 1 },
      checkoutRedirectFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(mocks.createCheckout.mock.calls[0]![1]).toEqual({
      idempotencyKey: 'keeprone-agency-invitation-invite-checkout-1-2',
    })
  })

  it.each([null, 'cus_original'])('retries the persisted attempt after input changes and session persistence fails (customer %s)', async (stripeCustomerId) => {
    const input = {
      stripeCustomerId,
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER' as const,
      inviterRole: 'OWNER' as const,
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    }
    let persisted: Record<string, unknown> | null = null
    mocks.findCheckout.mockImplementation(async () => persisted)
    mocks.createLocalCheckout.mockImplementation(async ({ data }) => {
      persisted = {
        ...data, id: 'invite-checkout-1', status: 'PENDING',
        stripeCheckoutSessionId: null, stripeSubscriptionId: null,
      }
      return persisted
    })
    mocks.updateLocalCheckout
      .mockRejectedValueOnce(new Error('SESSION_PERSIST_FAILED'))
      .mockImplementation(async ({ data }) => ({ ...persisted, ...data }))

    await expect(createStripeAgencyInvitationCheckout(input)).rejects.toThrow('SESSION_PERSIST_FAILED')
    expect(JSON.stringify(persisted)).not.toContain(input.invitationToken)
    expect(JSON.stringify(persisted)).not.toContain(input.origin)
    vi.stubEnv('STRIPE_INVITED_AGENT_PRICE_ID', 'price_changed_catalog')
    await expect(createStripeAgencyInvitationCheckout({
      ...input,
      acceptedTermsAt: new Date('2026-09-01T00:30:00.000Z'),
      invitedEmail: 'changed@example.com',
      stripeCustomerId: 'cus_changed',
      passwordHash: 'new-password-hash',
      plan: 'AGENCY',
      unitAmountCents: 999_999,
    })).resolves.toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/invitation-1',
      checkoutId: 'invite-checkout-1',
    })

    expect(mocks.createLocalCheckout).toHaveBeenCalledTimes(1)
    expect(mocks.createCheckout).toHaveBeenCalledTimes(2)
    const [firstParams, firstOptions] = mocks.createCheckout.mock.calls[0]!
    const [secondParams, secondOptions] = mocks.createCheckout.mock.calls[1]!
    expect(firstOptions.idempotencyKey).toBe('keeprone-agency-invitation-invite-checkout-1-1')
    expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
    expect(secondParams).toEqual(firstParams)
    expect(mocks.retrievePrice).toHaveBeenCalledTimes(1)
    expect(mocks.updateLocalCheckout).toHaveBeenCalledTimes(2)
    for (const [update] of mocks.updateLocalCheckout.mock.calls) {
      expect(update.data).toEqual({ stripeCheckoutSessionId: 'cs_live_invitation_1' })
    }
  })

  it('creates only a pending billing handoff before provider confirmation', async () => {
    const result = await createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })

    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/invitation-1',
      checkoutId: 'invite-checkout-1',
    })
    expect(mocks.createLocalCheckout).toHaveBeenCalledWith({
      data: {
        invitationId: 'invitation-1',
        email: 'invitee@example.com',
        name: 'Maria Invitee',
        agencyName: null,
        passwordHash: 'argon2-password-hash',
        userId: null,
        plan: 'AGENT_AGENCY_MEMBER',
        inviterRole: 'OWNER',
        unitAmountCents: 4_990,
        acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
        checkoutExpiresAt: new Date('2026-09-01T22:30:00.000Z'),
        attemptNumber: 1,
        stripeProductId: 'prod_VB4QfhI3X92UjL',
        stripePriceId: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
        stripeCustomerId: null,
        checkoutRedirectFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      select: expect.objectContaining({ id: true, attemptNumber: true }),
    })

    const [checkout] = mocks.createCheckout.mock.calls[0]!
    expect(checkout).toMatchObject({
      mode: 'subscription',
      client_reference_id: 'invite-checkout-1',
      customer_email: 'invitee@example.com',
      line_items: [{ price: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc', quantity: 1 }],
      metadata: {
        keeprOneAgencyInvitationCheckoutId: 'invite-checkout-1',
        keeprOneAgencyInvitationId: 'invitation-1',
        keeprOneInvitationPlan: 'AGENT_AGENCY_MEMBER',
      },
      subscription_data: {
        metadata: {
          keeprOneAgencyInvitationCheckoutId: 'invite-checkout-1',
          keeprOneAgencyInvitationId: 'invitation-1',
          keeprOneInvitationPlan: 'AGENT_AGENCY_MEMBER',
        },
      },
      expires_at: 1_788_301_800,
      success_url: 'https://app.keeprone.com/api/billing/invitation/complete?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: `https://app.keeprone.com/convites/agencia/${'a'.repeat(43)}?billing=canceled`,
    })
    expect(checkout).not.toHaveProperty('payment_method_types')
    expect(checkout).not.toHaveProperty('integration_identifier')
    expect(mocks.updateLocalCheckout).toHaveBeenCalledWith({
      where: { id: 'invite-checkout-1' },
      data: { stripeCheckoutSessionId: 'cs_live_invitation_1' },
    })
  })

  it('rejects a client amount that differs from the server invitation catalog', async () => {
    await expect(createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 3_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })).rejects.toThrow('STRIPE_INVITATION_AMOUNT_MISMATCH')

    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })

  it('reuses the same open Checkout instead of creating a duplicate subscription attempt', async () => {
    mocks.findCheckout.mockResolvedValue({
      id: 'invite-checkout-1',
      status: 'PENDING',
      stripeCheckoutSessionId: 'cs_live_existing1',
      stripeSubscriptionId: null,
    })

    const result = await createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })

    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/existing-invitation',
      checkoutId: 'invite-checkout-1',
    })
    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })

  it('starts one new attempt after the previous Checkout expires', async () => {
    mocks.findCheckout.mockResolvedValue({
      id: 'invite-checkout-1',
      status: 'PENDING',
      attemptNumber: 1,
      stripeCheckoutSessionId: 'cs_live_expired1',
      stripeSubscriptionId: null,
    })
    mocks.retrieveCheckout.mockResolvedValue({
      id: 'cs_live_expired1',
      status: 'expired',
      client_reference_id: 'invite-checkout-1',
      url: null,
    })
    mocks.updateLocalCheckout
      .mockImplementationOnce(async ({ data }) => ({ ...data, id: 'invite-checkout-1', attemptNumber: 2 }))
      .mockResolvedValueOnce({})

    const result = await createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'new-argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-09-01T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })

    expect(result.checkoutId).toBe('invite-checkout-1')
    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.updateLocalCheckout).toHaveBeenNthCalledWith(1, {
      where: { id: 'invite-checkout-1' },
      data: expect.objectContaining({
        passwordHash: 'new-argon2-password-hash',
        attemptNumber: { increment: 1 },
        stripeCheckoutSessionId: null,
      }),
      select: expect.objectContaining({ id: true, attemptNumber: true }),
    })
    expect(mocks.createCheckout.mock.calls[0]![1]).toEqual({
      idempotencyKey: 'keeprone-agency-invitation-invite-checkout-1-2',
    })
  })

  it('does not start a payable session when the invitation cannot reserve thirty minutes', async () => {
    await expect(createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-08-31T23:45:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })).rejects.toThrow('STRIPE_INVITATION_EXPIRY_TOO_CLOSE')

    expect(mocks.retrievePrice).not.toHaveBeenCalled()
    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })

  it('does not reserve billing after the invitation was revoked concurrently', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      id: 'invitation-1',
      status: 'REVOKED',
      expiresAt: new Date('2026-09-09T12:00:00.000Z'),
    })

    await expect(createStripeAgencyInvitationCheckout({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'argon2-password-hash',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: 'a'.repeat(43),
    })).rejects.toThrow('AGENCY_INVITATION_NOT_RESERVABLE')

    expect(mocks.createLocalCheckout).not.toHaveBeenCalled()
    expect(mocks.createCheckout).not.toHaveBeenCalled()
  })
})
