import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findAuthority: vi.fn(),
  checkoutFindUnique: vi.fn(),
  checkoutUpdateMany: vi.fn(),
  invitationFindUnique: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationUpdateMany: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  agentCreate: vi.fn(),
  agentUpdate: vi.fn(),
  agentFindMany: vi.fn(),
  membershipCreate: vi.fn(),
  membershipUpdateMany: vi.fn(),
  agencyCreate: vi.fn(),
  agencyUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionUpdate: vi.fn(),
  subscriptionCreate: vi.fn(),
  onboardingCreate: vi.fn(),
  founderUpdate: vi.fn(),
  auditCreate: vi.fn(),
}))

const transactionClient = {
  agencyInvitationCheckout: {
    findUnique: mocks.checkoutFindUnique,
    updateMany: mocks.checkoutUpdateMany,
  },
  agencyInvitation: {
    findUnique: mocks.invitationFindUnique,
    findFirst: mocks.invitationFindFirst,
    updateMany: mocks.invitationUpdateMany,
  },
  user: { findFirst: mocks.userFindFirst, create: mocks.userCreate },
  account: { create: mocks.accountCreate },
  agent: {
    create: mocks.agentCreate,
    update: mocks.agentUpdate,
    findMany: mocks.agentFindMany,
  },
  agencyMembership: {
    create: mocks.membershipCreate,
    updateMany: mocks.membershipUpdateMany,
  },
  agency: { create: mocks.agencyCreate, update: mocks.agencyUpdate },
  platformSubscription: {
    findFirst: mocks.subscriptionFindFirst,
    updateMany: mocks.subscriptionUpdateMany,
    update: mocks.subscriptionUpdate,
    create: mocks.subscriptionCreate,
  },
  agentOnboarding: { create: mocks.onboardingCreate },
  founderEnrollment: { update: mocks.founderUpdate },
  auditLog: { create: mocks.auditCreate },
}

vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))
vi.mock('@/lib/agency-invitation-authority', () => ({
  findActiveAgencyInvitationAuthority: mocks.findAuthority,
}))

import { finalizeAgencyInvitationAccess } from './agency-invitation-finalization'

const now = new Date('2026-09-01T00:00:00.000Z')
const provider = {
  status: 'ACTIVE' as const,
  stripeCustomerId: 'cus_invitation_1',
  stripeSubscriptionId: 'sub_invitation_1',
  stripeProductId: 'prod_VB4QfhI3X92UjL',
  stripePriceId: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
  currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
  cancelAtPeriodEnd: false,
  canceledAt: null,
}

function input() {
  return {
    checkoutId: 'invite-checkout-1',
    invitationId: 'invitation-1',
    expectedUserId: null,
    invitedEmail: 'invitee@example.com',
    name: 'Maria Invitee',
    agencyName: null,
    passwordHash: 'argon2-password-hash',
    plan: 'AGENT_AGENCY_MEMBER' as const,
    unitAmountCents: 4_990,
    provider,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient))
  mocks.checkoutFindUnique.mockResolvedValue({
    id: 'invite-checkout-1',
    invitationId: 'invitation-1',
    email: 'invitee@example.com',
    userId: null,
    plan: 'AGENT_AGENCY_MEMBER',
    inviterRole: 'OWNER',
    status: 'PENDING',
    unitAmountCents: 4_990,
    acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
    stripeSubscriptionId: null,
    platformSubscriptionId: null,
  })
  mocks.invitationFindUnique.mockResolvedValue({
    id: 'invitation-1',
    email: 'invitee@example.com',
    status: 'PENDING',
    expiresAt: new Date('2026-09-15T00:00:00.000Z'),
    intendedType: 'AGENT',
    monthlyPriceCents: 4_990,
    recruitmentStage: 'INVITED',
    stageUpdatedAt: new Date('2026-08-31T00:00:00.000Z'),
    agency: { id: 'parent-agency', name: 'Agência Principal' },
    invitedBy: { id: 'parent-agent', status: 'ACTIVE' },
  })
  mocks.findAuthority.mockResolvedValue({ id: 'owner-membership', role: 'OWNER' })
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.userCreate.mockResolvedValue({ id: 'new-user', email: 'invitee@example.com' })
  mocks.agentCreate.mockResolvedValue({
    id: 'new-agent',
    status: 'ACTIVE',
    parentAgentId: 'parent-agent',
    onboarding: null,
    founderEnrollment: null,
    agencyMemberships: [],
  })
  mocks.membershipCreate.mockResolvedValue({ id: 'member-1', agencyId: 'parent-agency' })
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 0 })
  mocks.subscriptionCreate.mockResolvedValue({ id: 'local-subscription-1' })
  mocks.invitationUpdateMany.mockResolvedValue({ count: 1 })
  mocks.checkoutUpdateMany.mockResolvedValue({ count: 1 })
})

afterEach(() => vi.useRealTimers())

describe('provider-confirmed agency invitation finalization', () => {
  it('creates the account, team link and exact provider-backed entitlement atomically', async () => {
    await expect(finalizeAgencyInvitationAccess(input())).resolves.toEqual({
      platformSubscriptionId: 'local-subscription-1',
      createdAccount: true,
    })

    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: {
        agencyId: 'parent-agency',
        agentId: 'new-agent',
        role: 'MEMBER',
        invitedByAgentId: 'parent-agent',
      },
      select: { id: true, agencyId: true },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: {
        plan: 'AGENT_AGENCY_MEMBER',
        agencyMembershipId: 'member-1',
        status: 'ACTIVE',
        unitAmountCents: 4_990,
        currency: 'USD',
        currentPeriodStart: provider.currentPeriodStart,
        currentPeriodEnd: provider.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        stripeCustomerId: 'cus_invitation_1',
        stripeSubscriptionId: 'sub_invitation_1',
        stripeProductId: 'prod_VB4QfhI3X92UjL',
        stripePriceId: 'price_1UAiJ0GJWjOaP9iwDnO3AaXc',
      },
    })
    expect(mocks.checkoutUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite-checkout-1',
        invitationId: 'invitation-1',
        status: 'PENDING',
      },
      data: {
        status: 'FINALIZED',
        userId: 'new-user',
        stripeCustomerId: 'cus_invitation_1',
        stripeSubscriptionId: 'sub_invitation_1',
        platformSubscriptionId: 'local-subscription-1',
        finalizedAt: now,
        passwordHash: null,
      },
    })
  })

  it('returns the original result for a repeated webhook without creating a second account', async () => {
    mocks.checkoutFindUnique.mockResolvedValue({
      id: 'invite-checkout-1',
      invitationId: 'invitation-1',
      email: 'invitee@example.com',
      userId: 'new-user',
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      status: 'FINALIZED',
      unitAmountCents: 4_990,
      acceptedTermsAt: new Date('2026-08-31T23:30:00.000Z'),
      stripeSubscriptionId: 'sub_invitation_1',
      platformSubscriptionId: 'local-subscription-1',
    })

    await expect(finalizeAgencyInvitationAccess(input())).resolves.toEqual({
      platformSubscriptionId: 'local-subscription-1',
      createdAccount: false,
    })
    expect(mocks.invitationFindUnique).not.toHaveBeenCalled()
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('rejects a stale invitation amount before creating identity or membership', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      ...(await mocks.invitationFindUnique()),
      monthlyPriceCents: 3_990,
    })

    await expect(finalizeAgencyInvitationAccess(input()))
      .rejects.toThrow('O preço deste convite não está mais disponível.')
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('honors a checkout reserved while the invite and issuer authority were valid', async () => {
    mocks.invitationFindUnique.mockResolvedValue({
      id: 'invitation-1',
      email: 'invitee@example.com',
      status: 'PENDING',
      expiresAt: new Date('2026-08-31T23:45:00.000Z'),
      intendedType: 'AGENT',
      monthlyPriceCents: 4_990,
      recruitmentStage: 'INVITED',
      stageUpdatedAt: new Date('2026-08-31T00:00:00.000Z'),
      agency: { id: 'parent-agency', name: 'Agência Principal' },
      invitedBy: { id: 'parent-agent', status: 'INACTIVE' },
    })

    await expect(finalizeAgencyInvitationAccess(input())).resolves.toEqual({
      platformSubscriptionId: 'local-subscription-1',
      createdAccount: true,
    })
    expect(mocks.findAuthority).not.toHaveBeenCalled()
  })
})
