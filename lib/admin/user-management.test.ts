import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  userFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  auditFindMany: vi.fn(),
  bookingFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      count: mocks.userCount,
      findMany: mocks.userFindMany,
      findUnique: mocks.userFindUnique,
    },
    auditLog: { findMany: mocks.auditFindMany },
    schedulingBooking: { findMany: mocks.bookingFindMany },
  },
}))

import {
  ADMIN_USER_PAGE_SIZE,
  buildAdminUserWhere,
  parseAdminUserDirectoryFilters,
  readAdminUserDirectory,
  readAdminUserDirectorySummary,
  type AdminUserDirectoryFilters,
} from './user-management'

const NOW = new Date('2026-09-01T18:00:00.000Z')
const PERIOD_START = new Date('2026-08-01T00:00:00.000Z')
const PERIOD_END = new Date('2026-09-15T00:00:00.000Z')

function filters(overrides: Partial<AdminUserDirectoryFilters> = {}): AdminUserDirectoryFilters {
  return {
    query: '',
    role: null,
    plan: null,
    accessStatus: null,
    subscriptionStatus: null,
    page: 1,
    ...overrides,
  }
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'subscription-1',
    plan: 'AGENT_INDIVIDUAL',
    status: 'ACTIVE',
    unitAmountCents: 5_990,
    currency: 'USD',
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    rank: 'AGENT',
    npn: '123456',
    phone: '+13055550100',
    status: 'ACTIVE',
    promotionAccessScope: 'PERSONAL',
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    parentAgent: null,
    _count: { subAgents: 0, clients: 0, policies: 0, insuranceCases: 0 },
    onboarding: null,
    founderEnrollment: null,
    adminProvisionedAccess: null,
    agencyInvitationsAccepted: [],
    integrationSessions: [],
    messagingChannels: [],
    platformSubscriptions: [],
    agencyMemberships: [],
    ...overrides,
  }
}

function agencyMembership(
  role: 'OWNER' | 'MEMBER',
  options: {
    agencySubscriptions?: unknown[]
    memberSubscriptions?: unknown[]
    agencyName?: string
  } = {},
) {
  return {
    id: `membership-${role.toLowerCase()}`,
    role,
    joinedAt: new Date('2026-08-01T00:00:00.000Z'),
    agency: {
      id: 'agency-1',
      name: options.agencyName ?? 'North Star',
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      parentAgency: null,
      subscriptions: options.agencySubscriptions ?? [],
      _count: { memberships: 4, childAgencies: 1 },
    },
    endedAt: null,
    subscriptions: options.memberSubscriptions ?? [],
  }
}

function managedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    name: 'Maria Silva',
    email: 'maria@example.com',
    role: 'AGENT',
    banned: false,
    banReason: null,
    banExpires: null,
    language: 'PT',
    timeZone: 'America/New_York',
    emailVerified: true,
    image: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    sessions: [],
    _count: { sessions: 0 },
    calendarIntegrations: [],
    schedulingPage: null,
    client: null,
    agent: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userCount.mockResolvedValue(0)
  mocks.userFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue(null)
  mocks.auditFindMany.mockResolvedValue([])
  mocks.bookingFindMany.mockResolvedValue([])
})

describe('parseAdminUserDirectoryFilters', () => {
  it('normalizes supported filters, takes the first repeated value and caps the search', () => {
    const parsed = parseAdminUserDirectoryFilters({
      q: [`  ${'x'.repeat(140)}  `, 'ignored'],
      role: 'AGENT',
      plan: 'AGENT_AGENCY_MEMBER',
      access: 'SUSPENDED',
      subscription: 'PAST_DUE',
      page: '3',
    })

    expect(parsed).toEqual({
      query: 'x'.repeat(120),
      role: 'AGENT',
      plan: 'AGENT',
      accessStatus: 'SUSPENDED',
      subscriptionStatus: 'PAST_DUE',
      page: 3,
    })
  })

  it('fails closed to neutral filters and page one for unsupported values', () => {
    expect(parseAdminUserDirectoryFilters({
      role: 'SUPER_ADMIN',
      plan: 'FREE',
      access: 'DELETED',
      subscription: 'PAUSED',
      page: '-10',
    })).toEqual({
      query: '',
      role: null,
      plan: null,
      accessStatus: null,
      subscriptionStatus: null,
      page: 1,
    })
  })
})

describe('buildAdminUserWhere', () => {
  it('combines role, suspension, exact commercial subject and subscription status', () => {
    const where = buildAdminUserWhere(filters({
      role: 'AGENT',
      plan: 'AGENCY',
      accessStatus: 'ACTIVE',
      subscriptionStatus: 'TRIALING',
    }), NOW) as { AND: Prisma.UserWhereInput[] }

    expect(where.AND.slice(0, 2)).toEqual([
      { role: 'AGENT' },
      { banned: false },
    ])
    const planFilter = JSON.stringify(where.AND[2])
    expect(planFilter).toContain('"acceptedPlan":"AGENCY"')
    expect(planFilter).toContain('"isCurrentCommercial":true')
    expect(planFilter).toContain('"accountType":"AGENCY"')
    const subscriptionFilter = JSON.stringify(where.AND[3])
    expect(subscriptionFilter).toContain('"isCurrentCommercial":true')
    expect(subscriptionFilter).toContain('"plan":"AGENCY"')
    expect(subscriptionFilter).toContain('"status":"TRIALING"')
    expect(subscriptionFilter).toContain('"status":"ACTIVE"')
  })

  it('groups individual and agency-linked agents under the public Agent plan filter', () => {
    const where = buildAdminUserWhere(filters({ plan: 'AGENT' }), NOW) as {
      AND: Prisma.UserWhereInput[]
    }
    const planFilter = JSON.stringify(where.AND[0])

    expect(planFilter).toContain('"plan":"AGENT_INDIVIDUAL"')
    expect(planFilter).toContain('"accountType":"AGENT"')
    expect(planFilter).toContain('"acceptedPlan":"AGENT_AGENCY_MEMBER"')
    expect(planFilter).toContain('"isCurrentCommercial":true')
  })

  it('searches identity, NPN, phone, agency and client fields case-insensitively', () => {
    const where = buildAdminUserWhere(filters({ query: 'North Star' })) as {
      AND: Array<{ OR?: unknown[] }>
    }
    const search = where.AND[0]

    expect(search.OR).toHaveLength(4)
    expect(search.OR).toEqual(expect.arrayContaining([
      { name: { contains: 'North Star', mode: 'insensitive' } },
      { email: { contains: 'North Star', mode: 'insensitive' } },
      expect.objectContaining({ agent: expect.any(Object) }),
      expect.objectContaining({ client: expect.any(Object) }),
    ]))
    expect(JSON.stringify(search)).toContain('agencyMemberships')
    expect(JSON.stringify(search)).toContain('npn')
    expect(JSON.stringify(search)).toContain('phone')
  })

  it('treats ACTIVE or TRIALING rows outside a complete billing window as expired', () => {
    const activeWhere = JSON.stringify(buildAdminUserWhere(filters({
      subscriptionStatus: 'ACTIVE',
    }), NOW))
    const expiredWhere = JSON.stringify(buildAdminUserWhere(filters({
      subscriptionStatus: 'EXPIRED',
    }), NOW))

    expect(activeWhere).toContain('"currentPeriodStart":{"lte"')
    expect(activeWhere).toContain('"currentPeriodEnd":{"gt"')
    expect(activeWhere).not.toContain('"currentPeriodStart":null')
    expect(expiredWhere).toContain('"currentPeriodStart":null')
    expect(expiredWhere).toContain('"status":{"in":["ACTIVE","TRIALING"]}')
  })
})

describe('readAdminUserDirectory', () => {
  it('uses bounded server-side pagination and clamps a page beyond the result set', async () => {
    mocks.userCount.mockResolvedValue(31)

    const result = await readAdminUserDirectory(filters({ page: 99 }), NOW)

    expect(result).toMatchObject({ total: 31, page: 3, pageCount: 3, rows: [] })
    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 30,
      take: ADMIN_USER_PAGE_SIZE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it('resolves every canonical plan and flags malformed commercial markers for review', async () => {
    const canceled = subscription({
      id: 'individual-canceled',
      status: 'CANCELED',
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
    })
    const activeIndividual = subscription({
      id: 'individual-active',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      createdAt: new Date('2026-08-15T00:00:00.000Z'),
    })
    const memberPlan = subscription({
      id: 'member-active',
      plan: 'AGENT_AGENCY_MEMBER',
      unitAmountCents: 4_990,
    })
    const agencyPlan = subscription({
      id: 'agency-trial',
      plan: 'AGENCY',
      status: 'TRIALING',
      unitAmountCents: 9_990,
    })
    const malformedActive = subscription({
      id: 'malformed-active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
    })
    const users = [
      managedUser({ id: 'admin-1', role: 'ADMIN', agent: null }),
      managedUser({ id: 'legacy-1', agent: agent({ id: 'legacy-agent' }) }),
      managedUser({
        id: 'review-1',
        agent: agent({
          id: 'review-agent',
          agencyInvitationsAccepted: [{
            id: 'legacy-invitation',
            acceptedPlan: null,
            acceptedMembership: null,
          }],
        }),
      }),
      managedUser({
        id: 'individual-1',
        role: 'AGENT',
        agent: agent({
          id: 'individual-agent',
          founderEnrollment: {
            accountType: 'AGENT',
            cohort: 'FOUNDERS_2026',
            trialStartedAt: PERIOD_START,
            trialEndsAt: PERIOD_END,
            agency: null,
          },
          platformSubscriptions: [canceled, activeIndividual],
        }),
      }),
      managedUser({
        id: 'expired-window-1',
        agent: agent({
          id: 'expired-window-agent',
          founderEnrollment: {
            accountType: 'AGENT',
            cohort: 'FOUNDERS_2026',
            trialStartedAt: PERIOD_START,
            trialEndsAt: PERIOD_END,
            agency: null,
          },
          platformSubscriptions: [malformedActive],
        }),
      }),
      managedUser({
        id: 'member-1',
        role: 'AGENT',
        agent: agent({
          id: 'member-agent',
          agencyInvitationsAccepted: [{
            id: 'member-invitation',
            acceptedPlan: 'AGENT_AGENCY_MEMBER',
            acceptedMembership: {
              ...agencyMembership('MEMBER', { memberSubscriptions: [memberPlan] }),
              endedAt: new Date('2026-08-31T00:00:00.000Z'),
            },
          }],
        }),
      }),
      managedUser({
        id: 'owner-1',
        role: 'AGENT',
        agent: agent({
          id: 'owner-agent',
          founderEnrollment: {
            accountType: 'AGENCY',
            cohort: 'FOUNDERS_2026',
            trialStartedAt: PERIOD_START,
            trialEndsAt: PERIOD_END,
            agency: agencyMembership('OWNER', {
              agencySubscriptions: [agencyPlan],
            }).agency,
          },
          agencyMemberships: [agencyMembership('OWNER', {
            agencySubscriptions: [agencyPlan],
          })],
        }),
      }),
    ]
    mocks.userCount.mockResolvedValue(users.length)
    mocks.userFindMany.mockResolvedValue(users)

    const result = await readAdminUserDirectory(filters(), NOW)
    const byId = new Map(result.rows.map((row) => [row.id, row]))

    expect(byId.get('admin-1')).toMatchObject({ plan: 'NOT_APPLICABLE', subscription: null })
    expect(byId.get('legacy-1')).toMatchObject({ plan: 'LEGACY', subscription: null })
    expect(byId.get('review-1')).toMatchObject({ plan: 'NEEDS_REVIEW', subscription: null })
    expect(byId.get('individual-1')).toMatchObject({
      plan: 'AGENT_INDIVIDUAL',
      subscription: {
        id: 'individual-active',
        status: 'ACTIVE',
        stripeCustomerLinked: true,
        stripeSubscriptionLinked: true,
        providerManaged: true,
      },
    })
    expect(byId.get('expired-window-1')).toMatchObject({
      plan: 'AGENT_INDIVIDUAL',
      subscription: {
        id: 'malformed-active',
        status: 'EXPIRED',
        rawStatus: 'ACTIVE',
      },
    })
    expect(byId.get('member-1')).toMatchObject({
      plan: 'AGENT_AGENCY_MEMBER',
      agency: { name: 'North Star', membershipRole: 'MEMBER' },
      subscription: { id: 'member-active', unitAmountCents: 4_990 },
    })
    expect(byId.get('owner-1')).toMatchObject({
      plan: 'AGENCY',
      agency: {
        name: 'North Star',
        membershipRole: 'OWNER',
        activeMemberCount: 4,
        childAgencyCount: 1,
      },
      subscription: {
        id: 'agency-trial',
        status: 'TRIALING',
        stripeCustomerLinked: false,
        stripeSubscriptionLinked: false,
      },
    })
  })

  it('presents expired or administratively blocked trials as requiring payment', async () => {
    const expiredTrial = subscription({
      id: 'expired-trial',
      status: 'TRIALING',
      currentPeriodEnd: NOW,
    })
    const blockedTrial = subscription({
      id: 'blocked-trial',
      status: 'TRIALING',
    })
    const restoredPaid = subscription({
      id: 'restored-paid',
      status: 'ACTIVE',
    })
    const provisionedAccess = (
      platformSubscription: ReturnType<typeof subscription>,
      paymentRequiredAt: Date | null,
    ) => ({
      id: `access-${platformSubscription.id}`,
      modules: ['DASHBOARD', 'JOURNEY'],
      paymentRequiredAt,
      paymentReason: paymentRequiredAt ? 'PAYMENT_REQUIRED' : null,
      createdAt: PERIOD_START,
      updatedAt: PERIOD_START,
      provisionedBy: { id: 'admin-1', name: 'Keepr One Admin' },
      updatedBy: null,
      platformSubscription,
    })
    const users = [
      managedUser({
        id: 'expired-trial-user',
        agent: agent({
          id: 'expired-trial-agent',
          adminProvisionedAccess: provisionedAccess(expiredTrial, null),
        }),
      }),
      managedUser({
        id: 'blocked-trial-user',
        agent: agent({
          id: 'blocked-trial-agent',
          adminProvisionedAccess: provisionedAccess(blockedTrial, PERIOD_START),
        }),
      }),
      managedUser({
        id: 'restored-paid-user',
        agent: agent({
          id: 'restored-paid-agent',
          adminProvisionedAccess: provisionedAccess(restoredPaid, PERIOD_START),
        }),
      }),
    ]
    mocks.userCount.mockResolvedValue(users.length)
    mocks.userFindMany.mockResolvedValue(users)

    const result = await readAdminUserDirectory(filters(), NOW)
    const byId = new Map(result.rows.map((row) => [row.id, row]))

    expect(byId.get('expired-trial-user')).toMatchObject({
      subscription: { status: 'EXPIRED', rawStatus: 'TRIALING' },
      productAccess: { source: 'ADMIN_PROVISIONED', status: 'PAYMENT_REQUIRED' },
    })
    expect(byId.get('blocked-trial-user')).toMatchObject({
      subscription: { status: 'TRIALING' },
      productAccess: { source: 'ADMIN_PROVISIONED', status: 'PAYMENT_REQUIRED' },
    })
    expect(byId.get('restored-paid-user')).toMatchObject({
      subscription: { status: 'ACTIVE' },
      productAccess: { source: 'ADMIN_PROVISIONED', status: 'ACTIVE' },
    })
  })
})

describe('readAdminUserDirectorySummary', () => {
  it('counts expired trials and administrative payment holds as payment attention', async () => {
    mocks.userCount
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(17)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(7)

    await expect(readAdminUserDirectorySummary(NOW)).resolves.toEqual({
      total: 20,
      active: 17,
      suspended: 3,
      agents: 12,
      agencies: 4,
      attention: 5,
      review: 1,
      needsAttention: 7,
    })

    const attentionWhere = mocks.userCount.mock.calls[5]?.[0]?.where
    const serializedAttention = JSON.stringify(attentionWhere)
    expect(serializedAttention).toContain('"status":"PAST_DUE"')
    expect(serializedAttention).toContain('"status":"EXPIRED"')
    expect(serializedAttention).toContain('"status":{"in":["ACTIVE","TRIALING"]}')
    expect(serializedAttention).toContain('"paymentRequiredAt":{"not":null}')
    expect(serializedAttention).toContain('"NOT":{"platformSubscription"')
    expect(serializedAttention).toContain('"status":"ACTIVE"')
    expect(serializedAttention).toContain('"currentPeriodEnd":{"gt"')

    const needsAttentionWhere = mocks.userCount.mock.calls[7]?.[0]?.where
    expect(needsAttentionWhere).toEqual({
      OR: [
        { banned: true },
        attentionWhere,
        expect.any(Object),
      ],
    })
  })
})
