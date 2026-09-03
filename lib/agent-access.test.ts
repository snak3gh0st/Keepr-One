import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findAgent: vi.fn(),
  findMembership: vi.fn(),
  findMemberships: vi.fn(),
  findIndividualSubscriptions: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: {
      findUnique: mocks.findAgent,
    },
    agencyMembership: {
      findFirst: mocks.findMembership,
      findMany: mocks.findMemberships,
    },
    platformSubscription: {
      findMany: mocks.findIndividualSubscriptions,
    },
  },
}))

vi.mock('@/lib/agent-context', () => ({
  getCurrentAgent: vi.fn(),
}))

import {
  getAgentAccessForAgent,
  getAgentScopeIds,
  requireAgencyCapability,
} from './agent-access'

const now = new Date('2026-08-26T00:00:00.000Z')

function subscription(
  plan: 'AGENT_INDIVIDUAL' | 'AGENCY' | 'AGENT_AGENCY_MEMBER',
  unitAmountCents: number,
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' = 'ACTIVE',
) {
  return {
    id: `subscription-${plan}`,
    plan,
    status,
    unitAmountCents,
    currency: 'USD',
    currentPeriodStart: now,
    currentPeriodEnd: new Date('2026-09-26T00:00:00.000Z'),
    cancelAtPeriodEnd: false,
  }
}

function membership(input: {
  role: 'OWNER' | 'MEMBER'
  agencySubscriptions?: ReturnType<typeof subscription>[]
  memberSubscriptions?: ReturnType<typeof subscription>[]
}) {
  return {
    id: 'membership-1',
    role: input.role,
    joinedAt: now,
    agency: {
      id: 'agency-1',
      name: 'Agência Exemplo',
      subscriptions: input.agencySubscriptions ?? [],
    },
    subscriptions: input.memberSubscriptions ?? [],
  }
}

describe('agent plan access boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.clearAllMocks()
    mocks.findAgent.mockResolvedValue({ status: 'ACTIVE' })
    mocks.findMembership.mockResolvedValue(null)
    mocks.findMemberships.mockResolvedValue([])
    mocks.findIndividualSubscriptions.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails closed to individual and self-only when no subscription exists', async () => {
    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'INDIVIDUAL',
      agencyId: null,
      subscriptionStatus: null,
      canManageTeam: false,
      canViewAgencyNationalLife: false,
      scopeAgentIds: ['agent-1'],
      enabledModules: null,
    })
    expect(mocks.findMemberships).not.toHaveBeenCalled()
  })

  it('returns the normalized module grants for an administratively provisioned agent', async () => {
    mocks.findAgent.mockResolvedValue({
      status: 'ACTIVE',
      adminProvisionedAccess: {
        modules: ['CRM', 'CRM', 'MESSAGES'],
      },
    })

    const access = await getAgentAccessForAgent('agent-1')

    expect(access.enabledModules).toEqual(['TODAY', 'CRM', 'MESSAGES'])
  })

  it('keeps an invited agency member inside a self-only data boundary', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'MEMBER',
        memberSubscriptions: [subscription('AGENT_AGENCY_MEMBER', 4_990)],
      }),
    )

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'AGENCY_MEMBER',
      agencyId: 'agency-1',
      agencyName: 'Agência Exemplo',
      subscriptionStatus: 'ACTIVE',
      canManageTeam: false,
      canInviteAgents: true,
      canViewTeamSubscriptions: false,
      canViewAgencyNationalLife: false,
      scopeAgentIds: ['agent-1'],
    })
  })

  it('grants the agency owner only active membership scope, never hierarchy scope', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'OWNER',
        agencySubscriptions: [subscription('AGENCY', 9_990)],
      }),
    )
    mocks.findMemberships.mockResolvedValue([
      { agentId: 'agent-1' },
      { agentId: 'agent-2' },
      { agentId: 'agent-2' },
    ])

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'AGENCY_OWNER',
      canManageTeam: true,
      canViewTeamData: true,
      canInviteAgents: true,
      canViewTeamSubscriptions: true,
      canViewAgencyNationalLife: true,
      scopeAgentIds: ['agent-1', 'agent-2'],
    })
    expect(mocks.findMemberships).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agencyId: 'agency-1',
          role: 'MEMBER',
          endedAt: null,
          agent: { status: 'ACTIVE' },
          subscriptions: {
            some: {
              plan: 'AGENT_AGENCY_MEMBER',
              status: { in: ['TRIALING', 'ACTIVE'] },
              AND: [
                {
                  OR: [
                    { currentPeriodStart: null },
                    { currentPeriodStart: { lte: expect.any(Date) } },
                  ],
                },
                {
                  OR: [
                    { currentPeriodEnd: null },
                    { currentPeriodEnd: { gt: expect.any(Date) } },
                  ],
                },
              ],
            },
          },
        },
      }),
    )
  })

  it('preserves agency identity but grants no agency rights without its required subscription', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'OWNER',
        agencySubscriptions: [],
      }),
    )
    mocks.findIndividualSubscriptions.mockResolvedValue([
      subscription('AGENT_INDIVIDUAL', 5_990),
    ])

    const access = await getAgentAccessForAgent('agent-1')

    expect(access.kind).toBe('AGENCY_OWNER')
    expect(access.agencyName).toBe('Agência Exemplo')
    expect(access.subscription).toBeNull()
    expect(access.canManageTeam).toBe(false)
    expect(access.scopeAgentIds).toEqual(['agent-1'])
    expect(mocks.findMemberships).not.toHaveBeenCalled()
  })

  it('keeps a past-due invited member visibly linked while removing entitlements', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'MEMBER',
        memberSubscriptions: [
          subscription('AGENT_AGENCY_MEMBER', 4_990, 'PAST_DUE'),
        ],
      }),
    )

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'AGENCY_MEMBER',
      agencyName: 'Agência Exemplo',
      subscriptionStatus: 'PAST_DUE',
      canManageTeam: false,
      canViewTeamData: false,
      canInviteAgents: false,
      scopeAgentIds: ['agent-1'],
    })
  })

  it('prefers a current entitlement over a newer canceled history row', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'OWNER',
        // Prisma returns these newest-first. Billing history must not shadow
        // the still-current subscription beneath it.
        agencySubscriptions: [
          subscription('AGENCY', 9_990, 'CANCELED'),
          subscription('AGENCY', 9_990, 'ACTIVE'),
        ],
      }),
    )

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'AGENCY_OWNER',
      subscriptionStatus: 'ACTIVE',
      canManageTeam: true,
    })
  })

  it('expires agency capabilities when an active status has a past billing period', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'OWNER',
        agencySubscriptions: [
          {
            ...subscription('AGENCY', 9_990),
            currentPeriodEnd: new Date('2020-01-01T00:00:00.000Z'),
          },
        ],
      }),
    )

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      kind: 'AGENCY_OWNER',
      subscriptionStatus: 'ACTIVE',
      canManageTeam: false,
      scopeAgentIds: ['agent-1'],
    })
  })

  it('enforces capabilities server-side and returns a defensive scope copy', async () => {
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'MEMBER',
        memberSubscriptions: [subscription('AGENT_AGENCY_MEMBER', 4_990)],
      }),
    )

    await expect(
      requireAgencyCapability('VIEW_AGENCY_NATIONAL_LIFE', 'agent-1'),
    ).rejects.toThrow('Forbidden: agency capability VIEW_AGENCY_NATIONAL_LIFE required')
    await expect(
      requireAgencyCapability('INVITE_AGENTS', 'agent-1'),
    ).resolves.toMatchObject({
      kind: 'AGENCY_MEMBER',
      canInviteAgents: true,
      canViewTeamData: false,
      scopeAgentIds: ['agent-1'],
    })

    const scope = await getAgentScopeIds('agent-1')
    scope.push('not-authorized')
    expect(await getAgentScopeIds('agent-1')).toEqual(['agent-1'])
  })

  it('removes all agency capabilities for an inactive agent', async () => {
    mocks.findAgent.mockResolvedValue({ status: 'INACTIVE' })
    mocks.findMembership.mockResolvedValue(
      membership({
        role: 'OWNER',
        agencySubscriptions: [subscription('AGENCY', 9_990)],
      }),
    )

    const access = await getAgentAccessForAgent('agent-1')

    expect(access).toMatchObject({
      isActive: false,
      kind: 'INDIVIDUAL',
      canManageTeam: false,
      canViewAgencyNationalLife: false,
      scopeAgentIds: ['agent-1'],
    })
    expect(mocks.findMemberships).not.toHaveBeenCalled()
  })
})
