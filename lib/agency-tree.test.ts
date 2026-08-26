import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findRootMembership: vi.fn(),
  findChildAgencies: vi.fn(),
  findMembers: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agencyMembership: {
      findFirst: mocks.findRootMembership,
      findMany: mocks.findMembers,
    },
    agency: {
      findMany: mocks.findChildAgencies,
    },
  },
}))

import { getAgencyTreeForAgent } from './agency-tree'

const now = new Date('2026-08-26T12:00:00.000Z')

const rootByAgent = {
  'agent-a': rootMembership('membership-a', 'agent-a', 'Ana', 'agency-a', 'Agência A'),
  'agent-b': rootMembership('membership-b', 'agent-b', 'Bruno', 'agency-b', 'Agência B'),
  'agent-c': rootMembership('membership-c', 'agent-c', 'Carla', 'agency-c', 'Agência C'),
  'agent-d': rootMembership('membership-d', 'agent-d', 'Diego', 'agency-d', 'Agência D'),
} as const

const childAgencies = [
  childAgency({
    id: 'agency-b',
    name: 'Agência B',
    parentAgencyId: 'agency-a',
    membershipId: 'membership-b',
    agentId: 'agent-b',
    agentName: 'Bruno',
    invitedByAgentId: 'agent-a',
    joinedAt: '2026-01-02T00:00:00.000Z',
  }),
  childAgency({
    id: 'agency-c',
    name: 'Agência C',
    parentAgencyId: 'agency-b',
    membershipId: 'membership-c',
    agentId: 'agent-c',
    agentName: 'Carla',
    invitedByAgentId: 'agent-b',
    joinedAt: '2026-01-04T00:00:00.000Z',
  }),
  childAgency({
    id: 'agency-d',
    name: 'Agência D',
    parentAgencyId: 'agency-a',
    membershipId: 'membership-d',
    agentId: 'agent-d',
    agentName: 'Diego',
    invitedByAgentId: 'agent-a',
    joinedAt: '2026-01-05T00:00:00.000Z',
  }),
]

const durableMembers = [
  member({
    id: 'membership-b-agent',
    agencyId: 'agency-b',
    agentId: 'agent-b-1',
    name: 'Bianca',
    invitedByAgentId: 'agent-b',
    joinedAt: '2026-01-03T00:00:00.000Z',
  }),
  member({
    id: 'membership-c-agent',
    agencyId: 'agency-c',
    agentId: 'agent-c-1',
    name: 'Caio',
    invitedByAgentId: 'agent-c',
    joinedAt: '2026-01-06T00:00:00.000Z',
  }),
]

function rootMembership(
  id: string,
  agentId: string,
  name: string,
  agencyId: string,
  agencyName: string,
) {
  return {
    id,
    agentId,
    invitedByAgentId: null,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    agent: { user: { name } },
    agency: {
      id: agencyId,
      name: agencyName,
      subscriptions: [{ status: 'ACTIVE' as const }],
    },
  }
}

function childAgency(input: {
  id: string
  name: string
  parentAgencyId: string
  membershipId: string
  agentId: string
  agentName: string
  invitedByAgentId: string
  joinedAt: string
  recruitmentStage?: 'ONBOARDING' | 'ACTIVE'
  subscriptionStatus?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | null
}) {
  return {
    id: input.id,
    name: input.name,
    parentAgencyId: input.parentAgencyId,
    memberships: [{
      id: input.membershipId,
      agentId: input.agentId,
      invitedByAgentId: input.invitedByAgentId,
      joinedAt: new Date(input.joinedAt),
      agent: { user: { name: input.agentName } },
      acceptedInvitation: {
        agencyId: input.parentAgencyId,
        acceptedAgentId: input.agentId,
        acceptedPlan: 'AGENCY' as const,
        status: 'ACCEPTED' as const,
        recruitmentStage: input.recruitmentStage ?? 'ONBOARDING' as const,
      },
    }],
    subscriptions: input.subscriptionStatus === null
      ? []
      : [{ status: input.subscriptionStatus ?? 'ACTIVE' as const }],
  }
}

function member(input: {
  id: string
  agencyId: string
  agentId: string
  name: string
  invitedByAgentId: string
  joinedAt: string
  recruitmentStage?: 'ONBOARDING' | 'ACTIVE'
  subscriptionStatus?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED' | null
}) {
  return {
    id: input.id,
    agencyId: input.agencyId,
    agentId: input.agentId,
    invitedByAgentId: input.invitedByAgentId,
    joinedAt: new Date(input.joinedAt),
    agent: { user: { name: input.name } },
    acceptedInvitation: {
      agencyId: input.agencyId,
      acceptedAgentId: input.agentId,
      acceptedPlan: 'AGENT_AGENCY_MEMBER' as const,
      status: 'ACCEPTED' as const,
      recruitmentStage: input.recruitmentStage ?? 'ACTIVE' as const,
    },
    subscriptions: input.subscriptionStatus === null
      ? []
      : [{ status: input.subscriptionStatus ?? 'ACTIVE' as const }],
  }
}

describe('commercial agency name tree', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.findRootMembership.mockImplementation(({ where }) => (
      rootByAgent[where.agentId as keyof typeof rootByAgent] ?? null
    ))
    mocks.findChildAgencies.mockImplementation(({ where }) => {
      const parentIds = new Set(where.parentAgencyId.in as string[])
      return childAgencies.filter((agency) => parentIds.has(agency.parentAgencyId))
    })
    mocks.findMembers.mockImplementation(({ where }) => {
      const agencyIds = new Set(where.agencyId.in as string[])
      return durableMembers.filter((item) => agencyIds.has(item.agencyId))
    })
  })

  it('returns A → B → C with agents under the owner who invited them', async () => {
    const tree = await getAgencyTreeForAgent('agent-a', now)

    expect(tree).toEqual([
      {
        agentId: 'agent-a',
        name: 'Ana',
        parentAgentId: null,
        depth: 0,
        kind: 'SELF',
        agencyId: 'agency-a',
        agencyName: 'Agência A',
        subscriptionStatus: 'ACTIVE',
        recruitmentStage: null,
      },
      expect.objectContaining({
        agentId: 'agent-b',
        parentAgentId: 'agent-a',
        depth: 1,
        kind: 'AGENCY',
        recruitmentStage: 'ONBOARDING',
      }),
      expect.objectContaining({
        agentId: 'agent-b-1',
        parentAgentId: 'agent-b',
        depth: 2,
        kind: 'AGENT',
        recruitmentStage: 'ACTIVE',
      }),
      expect.objectContaining({
        agentId: 'agent-c',
        parentAgentId: 'agent-b',
        depth: 2,
        kind: 'AGENCY',
      }),
      expect.objectContaining({
        agentId: 'agent-c-1',
        parentAgentId: 'agent-c',
        depth: 3,
        kind: 'AGENT',
      }),
      expect.objectContaining({
        agentId: 'agent-d',
        parentAgentId: 'agent-a',
        depth: 1,
        kind: 'AGENCY',
      }),
    ])
  })

  it('roots B at itself and never returns A or its sibling D', async () => {
    const tree = await getAgencyTreeForAgent('agent-b', now)

    expect(tree.map(({ agentId }) => agentId)).toEqual([
      'agent-b',
      'agent-b-1',
      'agent-c',
      'agent-c-1',
    ])
    expect(tree[0]).toMatchObject({
      agentId: 'agent-b',
      parentAgentId: null,
      depth: 0,
      kind: 'SELF',
    })
    expect(tree.map(({ agentId }) => agentId)).not.toContain('agent-a')
    expect(tree.map(({ agentId }) => agentId)).not.toContain('agent-d')
  })

  it('never consults legacy Agent.parentAgentId as commercial authorization', async () => {
    const tree = await getAgencyTreeForAgent('agent-c', now)

    expect(tree.map(({ agentId }) => agentId)).toEqual([
      'agent-c',
      'agent-c-1',
    ])
    expect(tree.map(({ agentId }) => agentId)).not.toContain('legacy-downline')
    expect(mocks.findChildAgencies).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentAgencyId: { in: ['agency-c'] } },
      }),
    )
  })

  it('fails closed when the root has no current agency entitlement', async () => {
    mocks.findRootMembership.mockResolvedValue({
      ...rootByAgent['agent-a'],
      agency: {
        ...rootByAgent['agent-a'].agency,
        subscriptions: [],
      },
    })

    await expect(getAgencyTreeForAgent('agent-a', now)).resolves.toEqual([])
    expect(mocks.findChildAgencies).not.toHaveBeenCalled()
    expect(mocks.findMembers).not.toHaveBeenCalled()
  })

  it('keeps an accepted branch visible when descendant subscriptions lapse or are missing', async () => {
    mocks.findChildAgencies.mockImplementation(({ where }) => {
      const parentIds = new Set(where.parentAgencyId.in as string[])
      return childAgencies
        .filter((agency) => parentIds.has(agency.parentAgencyId))
        .map((agency) => {
          if (agency.id === 'agency-b') {
            return {
              ...agency,
              subscriptions: [{
                status: 'ACTIVE' as const,
                currentPeriodEnd: new Date('2026-08-25T12:00:00.000Z'),
              }],
            }
          }
          if (agency.id === 'agency-c') {
            return { ...agency, subscriptions: [] }
          }
          return agency
        })
    })
    mocks.findMembers.mockImplementation(({ where }) => {
      const agencyIds = new Set(where.agencyId.in as string[])
      return durableMembers
        .filter((item) => agencyIds.has(item.agencyId))
        .map((item) => item.agentId === 'agent-b-1'
          ? {
              ...item,
              subscriptions: [{
                status: 'ACTIVE' as const,
                currentPeriodEnd: new Date('2026-08-25T12:00:00.000Z'),
              }],
            }
          : { ...item, subscriptions: [] })
    })

    const tree = await getAgencyTreeForAgent('agent-a', now)

    expect(tree.map(({ agentId }) => agentId)).toEqual([
      'agent-a',
      'agent-b',
      'agent-b-1',
      'agent-c',
      'agent-c-1',
      'agent-d',
    ])
    expect(tree.find(({ agentId }) => agentId === 'agent-b')).toMatchObject({
      subscriptionStatus: 'EXPIRED',
      recruitmentStage: 'ONBOARDING',
    })
    expect(tree.find(({ agentId }) => agentId === 'agent-b-1')).toMatchObject({
      subscriptionStatus: 'EXPIRED',
      recruitmentStage: 'ACTIVE',
    })
    expect(tree.find(({ agentId }) => agentId === 'agent-c')).toMatchObject({
      subscriptionStatus: 'NO_SUBSCRIPTION',
    })
    expect(tree.find(({ agentId }) => agentId === 'agent-c-1')).toMatchObject({
      subscriptionStatus: 'NO_SUBSCRIPTION',
    })

    expect(mocks.findChildAgencies).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        subscriptions: expect.objectContaining({ where: { plan: 'AGENCY' } }),
      }),
    }))
    expect(mocks.findMembers).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ subscriptions: expect.anything() }),
      select: expect.objectContaining({
        subscriptions: expect.objectContaining({
          where: { plan: 'AGENT_AGENCY_MEMBER' },
        }),
      }),
    }))
  })

  it('prunes a child whose owner was not accepted by the exact parent agency', async () => {
    mocks.findChildAgencies.mockImplementation(({ where }) => {
      const parentIds = new Set(where.parentAgencyId.in as string[])
      return childAgencies
        .filter((agency) => parentIds.has(agency.parentAgencyId))
        .map((agency) => agency.id === 'agency-b'
          ? {
              ...agency,
              memberships: [{
                ...agency.memberships[0],
                acceptedInvitation: {
                  ...agency.memberships[0].acceptedInvitation,
                  agencyId: 'unrelated-agency',
                },
              }],
            }
          : agency)
    })

    const tree = await getAgencyTreeForAgent('agent-a', now)

    expect(tree.map(({ agentId }) => agentId)).toEqual(['agent-a', 'agent-d'])
  })
})
