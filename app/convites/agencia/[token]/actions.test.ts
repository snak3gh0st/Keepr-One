import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashAgencyInvitationToken } from '@/lib/agency-invitations'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  hashPassword: vi.fn(),
  transaction: vi.fn(),
  invitationFindUnique: vi.fn(),
  invitationFindFirst: vi.fn(),
  invitationUpdateMany: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  agentCreate: vi.fn(),
  agentUpdate: vi.fn(),
  agentFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipUpdateMany: vi.fn(),
  membershipCreate: vi.fn(),
  agencyCreate: vi.fn(),
  agencyUpdate: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  subscriptionUpdate: vi.fn(),
  subscriptionCreate: vi.fn(),
  founderEnrollmentUpdate: vi.fn(),
  onboardingCreate: vi.fn(),
  auditCreate: vi.fn(),
  createInvitationCheckout: vi.fn(),
  providerSubscriptionFindFirst: vi.fn(),
}))

const transactionClient = {
  agencyInvitation: {
    findUnique: mocks.invitationFindUnique,
    findFirst: mocks.invitationFindFirst,
    updateMany: mocks.invitationUpdateMany,
  },
  user: {
    findFirst: mocks.userFindFirst,
    create: mocks.userCreate,
  },
  account: { create: mocks.accountCreate },
  agent: {
    create: mocks.agentCreate,
    update: mocks.agentUpdate,
    findMany: mocks.agentFindMany,
  },
  agencyMembership: {
    findFirst: mocks.membershipFindFirst,
    updateMany: mocks.membershipUpdateMany,
    create: mocks.membershipCreate,
  },
  agency: {
    create: mocks.agencyCreate,
    update: mocks.agencyUpdate,
  },
  platformSubscription: {
    updateMany: mocks.subscriptionUpdateMany,
    findFirst: mocks.subscriptionFindFirst,
    update: mocks.subscriptionUpdate,
    create: mocks.subscriptionCreate,
  },
  founderEnrollment: { update: mocks.founderEnrollmentUpdate },
  agentOnboarding: { create: mocks.onboardingCreate },
  auditLog: { create: mocks.auditCreate },
}

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('better-auth/crypto', () => ({ hashPassword: mocks.hashPassword }))
vi.mock('@/lib/stripe/agency-invitation-checkout', () => ({
  createStripeAgencyInvitationCheckout: mocks.createInvitationCheckout,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agencyInvitation: { findUnique: mocks.invitationFindUnique },
    agencyMembership: { findFirst: mocks.membershipFindFirst },
    platformSubscription: { findFirst: mocks.providerSubscriptionFindFirst },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}))

import {
  acceptAgencyInvitationAction,
  INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
} from './actions'

const token = 'a'.repeat(43)
const now = new Date('2026-08-26T12:00:00.000Z')

function invitation(overrides: Record<string, unknown> = {}) {
  const intendedType = Object.hasOwn(overrides, 'intendedType')
    ? overrides.intendedType
    : null
  return {
    id: 'invitation-1',
    email: 'invitee@example.com',
    name: 'Maria Invitee',
    status: 'PENDING',
    expiresAt: new Date('2026-09-09T12:00:00.000Z'),
    intendedType,
    monthlyPriceCents: intendedType === 'AGENCY' ? 8_990 : 4_990,
    recruitmentStage: 'INVITED',
    stageUpdatedAt: new Date('2026-08-25T12:00:00.000Z'),
    agency: { id: 'parent-agency', name: 'Agência Principal' },
    invitedBy: { id: 'parent-agent', status: 'ACTIVE' },
    ...overrides,
  }
}

function form(plan: 'AGENT_AGENCY_MEMBER' | 'AGENCY', overrides: Record<string, string> = {}) {
  const data = new FormData()
  data.set('token', token)
  data.set('plan', plan)
  data.set('name', 'Maria Invitee')
  data.set('agencyName', plan === 'AGENCY' ? 'Agência Maria' : '')
  data.set('password', 'StrongPassword123!')
  data.set('confirmPassword', 'StrongPassword123!')
  data.set('acceptedTerms', 'on')
  data.set('website', '')
  for (const [key, value] of Object.entries(overrides)) data.set(key, value)
  return data
}

function createdAgent(
  plan: 'AGENT_AGENCY_MEMBER' | 'AGENCY',
  parentAgentId = 'parent-agent',
) {
  return {
    id: 'new-agent',
    status: 'ACTIVE',
    parentAgentId,
    founderEnrollment: null,
    agencyMemberships: [],
    plan,
  }
}

function existingOwner() {
  return {
    id: 'existing-user',
    email: 'invitee@example.com',
    role: 'AGENT',
    agent: {
      id: 'existing-agent',
      status: 'ACTIVE',
      parentAgentId: null,
      founderEnrollment: null,
      adminProvisionedAccess: null as { id: string } | null,
      agencyMemberships: [{
        id: 'existing-owner-membership',
        role: 'OWNER',
        agencyId: 'existing-child-agency',
        agency: {
          id: 'existing-child-agency',
          name: 'Agência Existente',
          parentAgencyId: null,
        },
      }],
    },
  }
}

function existingDirectMember(options: {
  agencyId?: string
  onboardingStatus?: 'IN_PROGRESS' | 'COMPLETED'
} = {}) {
  const agencyId = options.agencyId ?? 'parent-agency'
  return {
    id: 'member-user',
    email: 'invitee@example.com',
    role: 'AGENT',
    agent: {
      id: 'member-agent',
      status: 'ACTIVE',
      parentAgentId: 'parent-agent',
      onboarding: { status: options.onboardingStatus ?? 'IN_PROGRESS' },
      founderEnrollment: null,
      adminProvisionedAccess: null as { id: string } | null,
      agencyMemberships: [{
        id: 'old-member-membership',
        role: 'MEMBER',
        agencyId,
        agency: {
          id: agencyId,
          name: agencyId === 'parent-agency' ? 'Agência Principal' : 'Outra Agência',
          parentAgencyId: null,
        },
      }],
    },
  }
}

const previousInvitationStageUpdatedAt = new Date('2026-08-20T12:00:00.000Z')

function arrangeDirectMemberPromotion(options: {
  invitationIntendedType?: 'AGENCY' | null
  memberAgencyId?: string
  onboardingStatus?: 'IN_PROGRESS' | 'COMPLETED'
  hasPreviousInvitation?: boolean
  hasMemberSubscription?: boolean
} = {}) {
  const member = existingDirectMember({
    agencyId: options.memberAgencyId,
    onboardingStatus: options.onboardingStatus,
  })
  mocks.invitationFindUnique.mockResolvedValue(invitation({
    intendedType: options.invitationIntendedType === undefined
      ? 'AGENCY'
      : options.invitationIntendedType,
  }))
  mocks.invitationFindFirst.mockResolvedValue(
    options.hasPreviousInvitation === false
      ? null
      : {
          id: 'old-agent-invitation',
          recruitmentStage: 'ACTIVE',
          stageUpdatedAt: previousInvitationStageUpdatedAt,
        },
  )
  mocks.userFindFirst.mockResolvedValue(member)
  mocks.getSession.mockResolvedValue({
    user: { id: member.id, email: member.email },
  })
  mocks.subscriptionFindFirst.mockImplementation(async ({ where }: {
    where: { agencyId?: string; agencyMembershipId?: string }
  }) => {
    if (where.agencyMembershipId === 'old-member-membership') {
      return options.hasMemberSubscription === false
        ? null
        : { id: 'old-member-subscription' }
    }
    if (where.agencyId === 'parent-agency') {
      return { id: 'parent-agency-subscription' }
    }
    return null
  })
  mocks.subscriptionUpdateMany.mockImplementation(async ({ where }: {
    where: { plan?: string }
  }) => ({ count: where.plan === 'AGENT_AGENCY_MEMBER' ? 1 : 0 }))
  return member
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('ALLOW_LOCAL_BILLING_SIMULATION', 'true')

  mocks.headers.mockResolvedValue(new Headers())
  mocks.getSession.mockResolvedValue(null)
  mocks.invitationFindUnique.mockResolvedValue(invitation())
  mocks.invitationFindFirst.mockResolvedValue(null)
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.hashPassword.mockResolvedValue('hashed-password')
  mocks.userCreate.mockResolvedValue({ id: 'new-user', email: 'invitee@example.com' })
  mocks.agentCreate.mockImplementation(async ({ data }: {
    data: { rank: string; parentAgentId: string }
  }) => createdAgent(
    data.rank === 'AGENCY_OWNER' ? 'AGENCY' : 'AGENT_AGENCY_MEMBER',
    data.parentAgentId,
  ))
  mocks.agentFindMany.mockResolvedValue([
    { id: 'parent-agent', parentAgentId: null },
    { id: 'existing-agent', parentAgentId: null },
  ])
  mocks.membershipFindFirst.mockResolvedValue({
    id: 'parent-owner-membership',
    role: 'OWNER',
  })
  mocks.membershipUpdateMany.mockResolvedValue({ count: 1 })
  mocks.membershipCreate.mockImplementation(async ({ data }: { data: { role: string } }) => ({
    id: data.role === 'OWNER' ? 'owner-membership' : 'member-membership',
    agencyId: data.role === 'OWNER' ? 'child-agency' : 'parent-agency',
  }))
  mocks.agencyCreate.mockResolvedValue({ id: 'child-agency' })
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 0 })
  mocks.subscriptionFindFirst.mockImplementation(async ({ where }: {
    where: { agencyId?: string }
  }) => where.agencyId === 'parent-agency' ? { id: 'parent-agency-subscription' } : null)
  mocks.subscriptionCreate.mockResolvedValue({ id: 'new-subscription' })
  mocks.subscriptionUpdate.mockResolvedValue({ id: 'updated-subscription' })
  mocks.createInvitationCheckout.mockResolvedValue({
    checkoutId: 'invite-checkout-1',
    checkoutUrl: 'https://checkout.stripe.com/c/pay/invitation-1',
  })
  mocks.providerSubscriptionFindFirst.mockResolvedValue(null)
  mocks.invitationUpdateMany.mockResolvedValue({ count: 1 })
  mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('acceptAgencyInvitationAction', () => {
  it('creates a new invited member, attaches it to the inviter and activates only the server-priced local plan', async () => {
    mocks.membershipFindFirst.mockResolvedValue({
      id: 'inviter-member-membership',
      role: 'MEMBER',
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(result).toMatchObject({
      status: 'success',
      createdAccount: true,
      nextUrl: '/login?invitation=accepted&email=invitee%40example.com',
    })
    expect(mocks.invitationFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashAgencyInvitationToken(token) } }),
    )
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith({
      where: {
        agencyId: 'parent-agency',
        agentId: 'parent-agent',
        endedAt: null,
        agent: { status: 'ACTIVE' },
        OR: [
          {
            role: 'OWNER',
            agency: {
              subscriptions: {
                some: {
                  plan: 'AGENCY',
                  status: { in: ['TRIALING', 'ACTIVE'] },
                  AND: [
                    { OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: now } }] },
                    { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] },
                  ],
                },
              },
            },
          },
          {
            role: 'MEMBER',
            subscriptions: {
              some: {
                plan: 'AGENT_AGENCY_MEMBER',
                status: { in: ['TRIALING', 'ACTIVE'] },
                AND: [
                  { OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: now } }] },
                  { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] },
                ],
              },
            },
          },
        ],
      },
      select: { id: true, role: true },
    })
    expect(mocks.agentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentAgentId: 'parent-agent',
        rank: 'AGENT',
        promotionAccessScope: 'PERSONAL',
      }),
    }))
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
        status: 'ACTIVE',
        agencyMembershipId: 'member-membership',
        unitAmountCents: 4_990,
        currency: 'USD',
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-09-25T12:00:00.000Z'),
      },
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'ACCEPTED',
        acceptedAgentId: 'new-agent',
        acceptedPlan: 'AGENT_AGENCY_MEMBER',
        acceptedMembershipId: 'member-membership',
        intendedType: 'AGENT',
        recruitmentStage: 'ONBOARDING',
        stageUpdatedAt: now,
      }),
    }))
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'new-agent',
        requiredModules: expect.not.arrayContaining(['TEAM']),
      }),
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ monthlyPriceCents: 4_990 }),
    }))
  })

  it('activates a typed agency invitation from its discounted price snapshot', async () => {
    mocks.invitationFindUnique.mockResolvedValue(invitation({ intendedType: 'AGENCY' }))

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result.status).toBe('success')
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENCY',
        unitAmountCents: 8_990,
      }),
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        intendedType: 'AGENCY',
        monthlyPriceCents: 8_990,
      }),
    }))
  })

  it('creates a child agency with its own OWNER and an AGENCY subscription, never a parent MEMBER', async () => {
    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result.status).toBe('success')
    expect(mocks.agencyCreate).toHaveBeenCalledWith({
      data: { name: 'Agência Maria', parentAgencyId: 'parent-agency' },
      select: { id: true },
    })
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: {
        agencyId: 'child-agency',
        agentId: 'new-agent',
        role: 'OWNER',
        invitedByAgentId: 'parent-agent',
      },
      select: { id: true },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: {
        plan: 'AGENCY',
        status: 'ACTIVE',
        agencyId: 'child-agency',
        unitAmountCents: 8_990,
        currency: 'USD',
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-09-25T12:00:00.000Z'),
      },
    })
    expect(mocks.membershipCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agencyId: 'parent-agency', role: 'MEMBER' }),
    }))
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'new-agent',
        requiredModules: expect.arrayContaining(['TEAM', 'INTEGRATIONS']),
      }),
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ monthlyPriceCents: 8_990 }),
    }))
  })

  it('places a new subagency below the active member who issued the invitation', async () => {
    mocks.invitationFindUnique.mockResolvedValue(invitation({
      intendedType: 'AGENCY',
      invitedBy: { id: 'member-inviter', status: 'ACTIVE' },
    }))
    mocks.membershipFindFirst.mockResolvedValue({
      id: 'inviter-member-membership',
      role: 'MEMBER',
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result.status).toBe('success')
    expect(mocks.agentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ parentAgentId: 'member-inviter' }),
    }))
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: {
        agencyId: 'child-agency',
        agentId: 'new-agent',
        role: 'OWNER',
        invitedByAgentId: 'member-inviter',
      },
      select: { id: true },
    })
    expect(mocks.agentUpdate).toHaveBeenCalledWith({
      where: { id: 'new-agent' },
      data: {
        parentAgentId: 'member-inviter',
        rank: 'AGENCY_OWNER',
        promotionAccessScope: 'AGENCY',
      },
    })
  })

  it('rejects an invitation sent to the issuer account before any transaction', async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: 'inviter-user',
      email: 'invitee@example.com',
      role: 'AGENT',
      agent: {
        id: 'parent-agent',
        status: 'ACTIVE',
        parentAgentId: null,
        founderEnrollment: null,
        agencyMemberships: [],
      },
    })
    mocks.getSession.mockResolvedValue({
      user: { id: 'inviter-user', email: 'invitee@example.com' },
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Você não pode aceitar um convite enviado pela própria conta.',
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('derives the plan server-side for a typed invitation even when the client omits it', async () => {
    mocks.invitationFindUnique.mockResolvedValue(invitation({ intendedType: 'AGENT' }))
    const typedInvitationForm = form('AGENT_AGENCY_MEMBER')
    typedInvitationForm.delete('plan')

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      typedInvitationForm,
    )

    expect(result.status).toBe('success')
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENT_AGENCY_MEMBER',
        unitAmountCents: 4_990,
      }),
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        acceptedPlan: 'AGENT_AGENCY_MEMBER',
        intendedType: 'AGENT',
      }),
    }))
  })

  it('rejects a client plan that diverges from the invitation type before account or billing writes', async () => {
    mocks.invitationFindUnique.mockResolvedValue(invitation({ intendedType: 'AGENCY' }))

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'O tipo deste convite foi definido pela agência e não pode ser alterado.',
      fieldErrors: {
        plan: ['O tipo deste convite foi definido pela agência e não pode ser alterado.'],
      },
    })
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('rejects a typed invitation whose stored price is not the current invitation price', async () => {
    mocks.invitationFindUnique.mockResolvedValue(invitation({
      intendedType: 'AGENCY',
      monthlyPriceCents: 9_990,
    }))

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'O preço deste convite não está mais disponível. Peça à agência para emitir um novo convite.',
    })
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('atomically promotes a direct MEMBER through a fresh AGENCY invitation', async () => {
    arrangeDirectMemberPromotion()

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toMatchObject({
      status: 'success',
      createdAccount: false,
      nextUrl: '/agent/agency',
    })
    expect(mocks.invitationFindFirst).toHaveBeenCalledWith({
      where: {
        agencyId: 'parent-agency',
        status: 'ACCEPTED',
        intendedType: 'AGENT',
        acceptedAgentId: 'member-agent',
        acceptedPlan: 'AGENT_AGENCY_MEMBER',
        acceptedMembershipId: 'old-member-membership',
      },
      select: {
        id: true,
        recruitmentStage: true,
        stageUpdatedAt: true,
      },
    })
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'old-member-subscription',
        agencyMembershipId: 'old-member-membership',
        plan: 'AGENT_AGENCY_MEMBER',
        status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
      },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        cancelAtPeriodEnd: false,
      },
    })
    expect(mocks.membershipUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'old-member-membership',
        agencyId: 'parent-agency',
        agentId: 'member-agent',
        role: 'MEMBER',
        endedAt: null,
      },
      data: { endedAt: now },
    })
    expect(mocks.agencyCreate).toHaveBeenCalledWith({
      data: { name: 'Agência Maria', parentAgencyId: 'parent-agency' },
      select: { id: true },
    })
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: {
        agencyId: 'child-agency',
        agentId: 'member-agent',
        role: 'OWNER',
        invitedByAgentId: 'parent-agent',
      },
      select: { id: true },
    })
    expect(mocks.agentUpdate).toHaveBeenCalledWith({
      where: { id: 'member-agent' },
      data: {
        parentAgentId: 'parent-agent',
        rank: 'AGENCY_OWNER',
        promotionAccessScope: 'AGENCY',
      },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: {
        plan: 'AGENCY',
        status: 'ACTIVE',
        agencyId: 'child-agency',
        unitAmountCents: 8_990,
        currency: 'USD',
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-09-25T12:00:00.000Z'),
      },
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'invitation-1', status: 'PENDING' }),
      data: expect.objectContaining({
        status: 'ACCEPTED',
        acceptedAgentId: 'member-agent',
        acceptedPlan: 'AGENCY',
        acceptedMembershipId: 'owner-membership',
        intendedType: 'AGENCY',
        recruitmentStage: 'ONBOARDING',
        isCurrentCommercial: true,
      }),
    }))
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: { acceptedAgentId: 'member-agent', isCurrentCommercial: true },
      data: { isCurrentCommercial: false },
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'old-agent-invitation',
        status: 'ACCEPTED',
        acceptedAgentId: 'member-agent',
        acceptedMembershipId: 'old-member-membership',
        stageUpdatedAt: previousInvitationStageUpdatedAt,
      },
      data: {
        recruitmentStage: 'PAUSED',
        stageUpdatedAt: now,
      },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENCY_INVITATION_ACCEPTED',
        entityId: 'invitation-1',
        after: expect.objectContaining({
          promotedFromInvitationId: 'old-agent-invitation',
          promotedFromMembershipId: 'old-member-membership',
        }),
      }),
    })
    expect(mocks.agencyUpdate).not.toHaveBeenCalled()

    const cancelOrder = mocks.subscriptionUpdateMany.mock.invocationCallOrder[0]
    const endMembershipOrder = mocks.membershipUpdateMany.mock.invocationCallOrder[0]
    const createOwnerOrder = mocks.membershipCreate.mock.invocationCallOrder[0]
    const createAgencyPlanOrder = mocks.subscriptionCreate.mock.invocationCallOrder[0]
    expect(cancelOrder).toBeLessThan(endMembershipOrder)
    expect(endMembershipOrder).toBeLessThan(createOwnerOrder)
    expect(createOwnerOrder).toBeLessThan(createAgencyPlanOrder)
  })

  it('marks a direct-member promotion ACTIVE when onboarding was already completed', async () => {
    arrangeDirectMemberPromotion({ onboardingStatus: 'COMPLETED' })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result.status).toBe('success')
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'invitation-1' }),
      data: expect.objectContaining({ recruitmentStage: 'ACTIVE' }),
    }))
  })

  it('does not let a member-issued invitation promote an existing member', async () => {
    arrangeDirectMemberPromotion()
    mocks.membershipFindFirst.mockResolvedValue({
      id: 'inviter-member-membership',
      role: 'MEMBER',
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este e-mail não está disponível para um novo convite.',
    })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
  })

  it('requires the fresh typed invitation and the prior accepted member invitation before promotion', async () => {
    arrangeDirectMemberPromotion({ invitationIntendedType: null })

    const legacyAttempt = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(legacyAttempt).toEqual({
      status: 'error',
      message: 'Este vínculo requer um novo convite de Agência.',
    })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.agencyCreate).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers())
    mocks.membershipFindFirst.mockResolvedValue({
      id: 'parent-owner-membership',
      role: 'OWNER',
    })
    mocks.membershipUpdateMany.mockResolvedValue({ count: 1 })
    mocks.invitationUpdateMany.mockResolvedValue({ count: 1 })
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient))
    arrangeDirectMemberPromotion({ hasPreviousInvitation: false })

    const missingHistory = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(missingHistory).toEqual({
      status: 'error',
      message: 'Este vínculo não está disponível para promoção. Solicite um novo convite à agência.',
    })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
  })

  it('does not end the MEMBER link when its current discounted subscription is missing', async () => {
    arrangeDirectMemberPromotion({ hasMemberSubscription: false })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este vínculo não está disponível para promoção. Solicite um novo convite à agência.',
    })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('aborts promotion when the discounted plan changes during the serializable transition', async () => {
    arrangeDirectMemberPromotion()
    mocks.subscriptionUpdateMany.mockResolvedValue({ count: 0 })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este vínculo mudou enquanto o convite era confirmado. Atualize a página e tente novamente.',
    })
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
  })

  it('never promotes or reparents a MEMBER belonging to another tenant', async () => {
    arrangeDirectMemberPromotion({ memberAgencyId: 'other-agency' })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este agente já está vinculado como membro de outra agência.',
    })
    expect(mocks.invitationFindFirst).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled()
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
    expect(mocks.agencyUpdate).not.toHaveBeenCalled()
  })

  it('connects an existing owned agency only after the same-email user signs in', async () => {
    const owner = existingOwner()
    mocks.userFindFirst.mockResolvedValue(owner)
    mocks.getSession.mockResolvedValue({
      user: { id: 'existing-user', email: 'invitee@example.com' },
    })
    mocks.subscriptionFindFirst.mockImplementation(async ({ where }: {
      where: { agencyId?: string }
    }) => where.agencyId === 'existing-child-agency'
      ? { id: 'existing-agency-subscription' }
      : { id: 'parent-agency-subscription' })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY', { agencyName: '' }),
    )

    expect(result).toMatchObject({ status: 'success', createdAccount: false, nextUrl: '/agent/agency' })
    expect(mocks.agencyUpdate).toHaveBeenCalledWith({
      where: { id: 'existing-child-agency' },
      data: { parentAgencyId: 'parent-agency' },
    })
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: 'existing-agency-subscription' },
      data: {
        status: 'ACTIVE',
        unitAmountCents: 8_990,
        currency: 'USD',
        currentPeriodStart: now,
        currentPeriodEnd: new Date('2026-09-25T12:00:00.000Z'),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    })
    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        acceptedAgentId: 'existing-agent',
        acceptedPlan: 'AGENCY',
        acceptedMembershipId: 'existing-owner-membership',
        intendedType: 'AGENCY',
        recruitmentStage: 'ACTIVE',
        stageUpdatedAt: now,
      }),
    }))
    expect(mocks.onboardingCreate).not.toHaveBeenCalled()
  })

  it('rejects an existing account unless the session belongs to the invited email', async () => {
    mocks.userFindFirst.mockResolvedValue(existingOwner())
    mocks.getSession.mockResolvedValue({
      user: { id: 'different-user', email: 'other@example.com' },
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Entre com a conta que recebeu este convite antes de continuar.',
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects a forged member-plan acceptance for an existing Founder account', async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: 'founder-user',
      email: 'invitee@example.com',
      role: 'AGENT',
      agent: {
        id: 'founder-agent',
        status: 'ACTIVE',
        parentAgentId: null,
        founderEnrollment: { id: 'founder-enrollment', accountType: 'AGENT' },
        agencyMemberships: [],
      },
    })
    mocks.getSession.mockResolvedValue({
      user: { id: 'founder-user', email: 'invitee@example.com' },
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Nesta primeira versão, uma conta Founder deve escolher o plano Agência para mudar de estrutura.',
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('blocks an admin-provisioned account before opening Stripe Checkout', async () => {
    const owner = existingOwner()
    owner.agent.adminProvisionedAccess = { id: 'admin-access-1' }
    mocks.userFindFirst.mockResolvedValue(owner)
    mocks.getSession.mockResolvedValue({ user: { id: owner.id, email: owner.email } })
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.keeprone.com')

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Esta conta é gerenciada pela Keepr One. A mudança para um plano por convite precisa ser concluída pelo suporte.',
    })
    expect(mocks.providerSubscriptionFindFirst).not.toHaveBeenCalled()
    expect(mocks.createInvitationCheckout).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rechecks admin-provisioned access inside local atomic acceptance', async () => {
    const ownerBeforeTransaction = existingOwner()
    const ownerInsideTransaction = existingOwner()
    ownerInsideTransaction.agent.adminProvisionedAccess = { id: 'admin-access-1' }
    mocks.userFindFirst
      .mockResolvedValueOnce(ownerBeforeTransaction)
      .mockResolvedValueOnce(ownerInsideTransaction)
    mocks.getSession.mockResolvedValue({
      user: { id: ownerBeforeTransaction.id, email: ownerBeforeTransaction.email },
    })

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Esta conta é gerenciada pela Keepr One. A mudança para um plano por convite precisa ser concluída pelo suporte.',
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.agentFindMany).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
  })

  it('opens Stripe Checkout in production without creating access before provider confirmation', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_LOCAL_BILLING_SIMULATION', 'true')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.keeprone.com')

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(result).toEqual({
      status: 'checkout',
      message: 'Checkout seguro preparado. Você será direcionado para a Stripe.',
      nextUrl: 'https://checkout.stripe.com/c/pay/invitation-1',
      createdAccount: false,
    })
    expect(mocks.createInvitationCheckout).toHaveBeenCalledWith({
      invitationId: 'invitation-1',
      invitedEmail: 'invitee@example.com',
      name: 'Maria Invitee',
      agencyName: null,
      passwordHash: 'hashed-password',
      userId: null,
      plan: 'AGENT_AGENCY_MEMBER',
      inviterRole: 'OWNER',
      unitAmountCents: 4_990,
      acceptedTermsAt: now,
      invitationExpiresAt: new Date('2026-09-09T12:00:00.000Z'),
      origin: 'https://app.keeprone.com',
      invitationToken: token,
      stripeCustomerId: null,
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('does not create a second provider subscription for an existing billed invitee', async () => {
    const owner = existingOwner()
    mocks.userFindFirst.mockResolvedValue(owner)
    mocks.getSession.mockResolvedValue({ user: { id: owner.id, email: owner.email } })
    mocks.providerSubscriptionFindFirst.mockResolvedValue({
      id: 'current-provider-subscription',
      stripeCustomerId: 'cus_existing',
      stripeSubscriptionId: 'sub_existing',
    })
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.keeprone.com')

    const result = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENCY'),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('já possui uma assinatura vinculada à Stripe')
    expect(mocks.createInvitationCheckout).not.toHaveBeenCalled()
  })

  it('fails closed when the inviter no longer has an active invitation authority', async () => {
    mocks.membershipFindFirst.mockResolvedValue(null)

    const noOwner = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(noOwner).toEqual({
      status: 'error',
      message: 'A agência que enviou este convite não possui autorização e assinatura ativas.',
    })
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers())
    mocks.getSession.mockResolvedValue(null)
    mocks.invitationFindUnique.mockResolvedValue(invitation())
    mocks.userFindFirst.mockResolvedValue(null)
    mocks.hashPassword.mockResolvedValue('hashed-password')
    mocks.membershipFindFirst.mockResolvedValue(null)
    mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
      callback(transactionClient))

    const noEntitlement = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )

    expect(noEntitlement).toEqual({
      status: 'error',
      message: 'A agência que enviou este convite não possui autorização e assinatura ativas.',
    })
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.membershipCreate).not.toHaveBeenCalled()
  })

  it('rejects malformed, expired and concurrently replayed tokens without claiming twice', async () => {
    const malformed = form('AGENT_AGENCY_MEMBER', { token: '../bad-token' })
    expect((await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      malformed,
    )).status).toBe('error')
    expect(mocks.invitationFindUnique).not.toHaveBeenCalled()

    mocks.invitationFindUnique.mockResolvedValue(invitation({
      expiresAt: new Date('2026-08-26T11:59:59.000Z'),
    }))
    expect((await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )).status).toBe('error')
    expect(mocks.transaction).not.toHaveBeenCalled()

    mocks.invitationFindUnique.mockResolvedValue(invitation())
    mocks.invitationUpdateMany.mockResolvedValue({ count: 0 })
    const replay = await acceptAgencyInvitationAction(
      INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE,
      form('AGENT_AGENCY_MEMBER'),
    )
    expect(replay).toEqual({
      status: 'error',
      message: 'Este convite já foi utilizado por outra solicitação.',
    })
  })
})
