import 'server-only'

import type {
  PlatformPlan,
  PlatformSubscriptionStatus,
  Prisma,
  Role,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const ADMIN_USER_PAGE_SIZE = 15

export type AdminUserPlanFilter = 'AGENT' | 'AGENCY' | 'LEGACY' | 'NEEDS_REVIEW' | 'NOT_APPLICABLE'
export type AdminUserSubscriptionFilter = PlatformSubscriptionStatus | 'NO_SUBSCRIPTION'
export type AdminUserAccessFilter = 'ACTIVE' | 'SUSPENDED'
export type AdminUserDirectoryFilters = {
  query: string
  role: Role | null
  plan: AdminUserPlanFilter | null
  accessStatus: AdminUserAccessFilter | null
  subscriptionStatus: AdminUserSubscriptionFilter | null
  page: number
}

export type AdminUserPlan = PlatformPlan | 'LEGACY' | 'NEEDS_REVIEW' | 'NOT_APPLICABLE'

const roles = new Set<Role>(['ADMIN', 'AGENT', 'CLIENT'])
const plans = new Set<AdminUserPlanFilter>([
  'AGENT',
  'AGENCY',
  'LEGACY',
  'NEEDS_REVIEW',
  'NOT_APPLICABLE',
])
const accessStatuses = new Set<AdminUserAccessFilter>(['ACTIVE', 'SUSPENDED'])
const subscriptionStatuses = new Set<AdminUserSubscriptionFilter>([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
  'NO_SUBSCRIPTION',
])

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function enumParam<T extends string>(value: string, allowed: ReadonlySet<T>): T | null {
  return allowed.has(value as T) ? (value as T) : null
}

export function parseAdminUserDirectoryFilters(
  params: Record<string, string | string[] | undefined>,
): AdminUserDirectoryFilters {
  const rawPage = Number.parseInt(firstParam(params.page), 10)
  const rawPlan = firstParam(params.plan)
  const normalizedPlan = rawPlan === 'AGENT_INDIVIDUAL' || rawPlan === 'AGENT_AGENCY_MEMBER'
    ? 'AGENT'
    : rawPlan
  return {
    query: firstParam(params.q).trim().slice(0, 120),
    role: enumParam(firstParam(params.role), roles),
    plan: enumParam(normalizedPlan, plans),
    accessStatus: enumParam(firstParam(params.access), accessStatuses),
    subscriptionStatus: enumParam(
      firstParam(params.subscription),
      subscriptionStatuses,
    ),
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  }
}

const noAcceptedInvitation = {
  none: { status: 'ACCEPTED' as const, isCurrentCommercial: true },
}

const legacyPlanCondition: Prisma.UserWhereInput = {
  agent: {
    is: {
      founderEnrollment: null,
      adminProvisionedAccess: null,
      agencyInvitationsAccepted: noAcceptedInvitation,
    },
  },
}

function acceptedInvitationPlanCondition(plan: 'AGENCY' | 'AGENT_AGENCY_MEMBER'):
Prisma.UserWhereInput {
  return {
    agent: {
      is: {
        agencyInvitationsAccepted: {
          some: { status: 'ACCEPTED', isCurrentCommercial: true, acceptedPlan: plan },
        },
      },
    },
  }
}

function planCondition(plan: AdminUserPlanFilter): Prisma.UserWhereInput {
  if (plan === 'AGENT') {
    return {
      OR: [
        {
          agent: {
            is: {
              agencyInvitationsAccepted: noAcceptedInvitation,
              adminProvisionedAccess: {
                is: { platformSubscription: { is: { plan: 'AGENT_INDIVIDUAL' } } },
              },
            },
          },
        },
        {
          agent: {
            is: {
              agencyInvitationsAccepted: noAcceptedInvitation,
              adminProvisionedAccess: null,
              founderEnrollment: { is: { accountType: 'AGENT' } },
            },
          },
        },
        acceptedInvitationPlanCondition('AGENT_AGENCY_MEMBER'),
      ],
    }
  }
  if (plan === 'AGENCY') {
    return {
      OR: [
        acceptedInvitationPlanCondition('AGENCY'),
        {
          agent: {
            is: {
              agencyInvitationsAccepted: noAcceptedInvitation,
              adminProvisionedAccess: {
                is: { platformSubscription: { is: { plan: 'AGENCY' } } },
              },
            },
          },
        },
        {
          agent: {
            is: {
              agencyInvitationsAccepted: noAcceptedInvitation,
              adminProvisionedAccess: null,
              founderEnrollment: { is: { accountType: 'AGENCY' } },
            },
          },
        },
      ],
    }
  }
  if (plan === 'NEEDS_REVIEW') {
    return {
      agent: {
        is: {
          agencyInvitationsAccepted: {
            some: {
              status: 'ACCEPTED',
              isCurrentCommercial: true,
              acceptedPlan: null,
            },
          },
        },
      },
    }
  }
  if (plan === 'NOT_APPLICABLE') return { agent: { is: null } }
  return legacyPlanCondition
}

function activeWindow(status: 'ACTIVE' | 'TRIALING', now: Date) {
  return {
    status,
    currentPeriodStart: { lte: now },
    currentPeriodEnd: { gt: now },
  } satisfies Prisma.PlatformSubscriptionWhereInput
}

function invalidActiveWindow(now: Date): Prisma.PlatformSubscriptionWhereInput {
  return {
    AND: [
      { status: { in: ['ACTIVE', 'TRIALING'] } },
      {
        OR: [
          { currentPeriodStart: null },
          { currentPeriodEnd: null },
          { currentPeriodStart: { gt: now } },
          { currentPeriodEnd: { lte: now } },
        ],
      },
    ],
  }
}

function subscriptionRelationFilter(
  status: PlatformSubscriptionStatus,
  plan: PlatformPlan,
  now: Date,
): Prisma.PlatformSubscriptionListRelationFilter {
  const active = activeWindow('ACTIVE', now)
  const trialing = activeWindow('TRIALING', now)
  const priority: Prisma.PlatformSubscriptionWhereInput[] = [
    active,
    trialing,
    { status: 'PAST_DUE' },
    { status: 'CANCELED' },
    { OR: [{ status: 'EXPIRED' }, invalidActiveWindow(now)] },
  ]
  const index = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED'].indexOf(status)
  const matching = priority[index] ?? { status }
  const higher = priority.slice(0, Math.max(0, index))
  return {
    some: { plan, ...matching },
    ...(higher.length > 0 ? { none: { plan, OR: higher } } : {}),
  }
}

function noSubscriptionCondition(): Prisma.UserWhereInput {
  return {
    OR: [
      { agent: { is: null } },
      legacyPlanCondition,
      planCondition('NEEDS_REVIEW'),
      {
        agent: {
          is: {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: null,
            founderEnrollment: { is: { accountType: 'AGENT' } },
            platformSubscriptions: { none: { plan: 'AGENT_INDIVIDUAL' } },
          },
        },
      },
      {
        agent: {
          is: {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: null,
            founderEnrollment: {
              is: {
                accountType: 'AGENCY',
                agency: { is: { subscriptions: { none: { plan: 'AGENCY' } } } },
              },
            },
          },
        },
      },
      {
        agent: {
          is: {
            agencyInvitationsAccepted: {
              some: {
                status: 'ACCEPTED',
                isCurrentCommercial: true,
                acceptedPlan: 'AGENT_AGENCY_MEMBER',
                OR: [
                  { acceptedMembership: { is: null } },
                  {
                    acceptedMembership: {
                      is: {
                        subscriptions: { none: { plan: 'AGENT_AGENCY_MEMBER' } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        agent: {
          is: {
            agencyInvitationsAccepted: {
              some: {
                status: 'ACCEPTED',
                isCurrentCommercial: true,
                acceptedPlan: 'AGENCY',
                OR: [
                  { acceptedMembership: { is: null } },
                  {
                    acceptedMembership: {
                      is: {
                        agency: { subscriptions: { none: { plan: 'AGENCY' } } },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ],
  }
}

function subscriptionStatusCondition(
  status: AdminUserSubscriptionFilter,
  now: Date,
): Prisma.UserWhereInput {
  if (status === 'NO_SUBSCRIPTION') return noSubscriptionCondition()
  const directSubscriptions = subscriptionRelationFilter(status, 'AGENT_INDIVIDUAL', now)
  const agencySubscriptions = subscriptionRelationFilter(status, 'AGENCY', now)
  const memberSubscriptions = subscriptionRelationFilter(status, 'AGENT_AGENCY_MEMBER', now)
  const singleSubscriptionStatus: Prisma.PlatformSubscriptionWhereInput = status === 'ACTIVE'
    ? activeWindow('ACTIVE', now)
    : status === 'TRIALING'
      ? activeWindow('TRIALING', now)
      : status === 'EXPIRED'
        ? { OR: [{ status: 'EXPIRED' }, invalidActiveWindow(now)] }
        : { status }
  return {
    agent: {
      is: {
        OR: [
          {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: {
              is: { platformSubscription: { is: singleSubscriptionStatus } },
            },
          },
          {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: null,
            founderEnrollment: { is: { accountType: 'AGENT' } },
            platformSubscriptions: directSubscriptions,
          },
          {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: null,
            founderEnrollment: {
              is: {
                accountType: 'AGENCY',
                agency: { is: { subscriptions: agencySubscriptions } },
              },
            },
          },
          {
            agencyInvitationsAccepted: {
              some: {
                status: 'ACCEPTED',
                isCurrentCommercial: true,
                acceptedPlan: 'AGENT_AGENCY_MEMBER',
                acceptedMembership: { is: { subscriptions: memberSubscriptions } },
              },
            },
          },
          {
            agencyInvitationsAccepted: {
              some: {
                status: 'ACCEPTED',
                isCurrentCommercial: true,
                acceptedPlan: 'AGENCY',
                acceptedMembership: {
                  is: { agency: { subscriptions: agencySubscriptions } },
                },
              },
            },
          },
        ],
      },
    },
  }
}

function paymentAttentionCondition(now: Date): Prisma.UserWhereInput {
  const pastDue = subscriptionStatusCondition('PAST_DUE', now)
  const expired = subscriptionStatusCondition('EXPIRED', now)

  return {
    OR: [
      pastDue,
      expired,
      {
        agent: {
          is: {
            agencyInvitationsAccepted: noAcceptedInvitation,
            adminProvisionedAccess: {
              is: {
                paymentRequiredAt: { not: null },
                // A provider-confirmed, current ACTIVE subscription restores access
                // even when an older administrative payment marker still exists.
                NOT: {
                  platformSubscription: { is: activeWindow('ACTIVE', now) },
                },
              },
            },
          },
        },
      },
    ],
  }
}

export function buildAdminUserWhere(
  filters: AdminUserDirectoryFilters,
  now = new Date(),
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = []
  if (filters.role) and.push({ role: filters.role })
  if (filters.accessStatus) and.push({ banned: filters.accessStatus === 'SUSPENDED' })
  if (filters.plan) and.push(planCondition(filters.plan))
  if (filters.subscriptionStatus) {
    and.push(subscriptionStatusCondition(filters.subscriptionStatus, now))
  }
  if (filters.query) {
    and.push({
      OR: [
        { name: { contains: filters.query, mode: 'insensitive' } },
        { email: { contains: filters.query, mode: 'insensitive' } },
        {
          agent: {
            is: {
              OR: [
                { npn: { contains: filters.query, mode: 'insensitive' } },
                { phone: { contains: filters.query, mode: 'insensitive' } },
                {
                  agencyMemberships: {
                    some: {
                      endedAt: null,
                      agency: {
                        name: { contains: filters.query, mode: 'insensitive' },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        {
          client: {
            is: {
              OR: [
                { name: { contains: filters.query, mode: 'insensitive' } },
                { phone: { contains: filters.query, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    })
  }
  return and.length === 0 ? {} : { AND: and }
}

const subscriptionSelect = {
  id: true,
  plan: true,
  status: true,
  unitAmountCents: true,
  currency: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlatformSubscriptionSelect

const managedAgencySelect = {
  id: true,
  name: true,
  updatedAt: true,
  parentAgency: { select: { id: true, name: true } },
  invitations: {
    where: { status: 'PENDING' as const },
    select: {
      expiresAt: true,
      checkout: {
        select: { status: true, checkoutExpiresAt: true },
      },
    },
  },
  subscriptions: {
    where: { plan: 'AGENCY' as const },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 10,
    select: subscriptionSelect,
  },
  _count: {
    select: {
      memberships: { where: { endedAt: null } },
      childAgencies: true,
    },
  },
} satisfies Prisma.AgencySelect

const managedUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  banReason: true,
  banExpires: true,
  language: true,
  timeZone: true,
  emailVerified: true,
  image: true,
  createdAt: true,
  updatedAt: true,
  pendingEmailChange: {
    select: {
      newEmail: true,
      expiresAt: true,
      currentApprovedAt: true,
      newTokenExpiresAt: true,
      createdAt: true,
    },
  },
  sessions: {
    orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 5,
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
  },
  _count: { select: { sessions: true } },
  calendarIntegrations: {
    orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      provider: true,
      providerEmail: true,
      displayName: true,
      status: true,
      connectedAt: true,
      lastSyncAt: true,
      lastErrorCode: true,
      updatedAt: true,
    },
  },
  schedulingPage: {
    select: {
      enabled: true,
      slug: true,
      title: true,
      durationMinutes: true,
      updatedAt: true,
    },
  },
  client: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
      assignedAgent: { select: { id: true, user: { select: { name: true } } } },
      _count: { select: { policies: true, insuranceCases: true } },
    },
  },
  agent: {
    select: {
      id: true,
      rank: true,
      npn: true,
      phone: true,
      status: true,
      promotionAccessScope: true,
      updatedAt: true,
      parentAgent: { select: { id: true, user: { select: { name: true } } } },
      _count: {
        select: {
          subAgents: true,
          clients: true,
          policies: true,
          insuranceCases: true,
        },
      },
      onboarding: {
        select: {
          status: true,
          currentStep: true,
          completedAt: true,
          updatedAt: true,
        },
      },
      founderEnrollment: {
        select: {
          accountType: true,
          cohort: true,
          trialStartedAt: true,
          trialEndsAt: true,
          agency: { select: managedAgencySelect },
        },
      },
      adminProvisionedAccess: {
        select: {
          id: true,
          modules: true,
          paymentRequiredAt: true,
          paymentReason: true,
          createdAt: true,
          updatedAt: true,
          provisionedBy: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          platformSubscription: {
            select: {
              ...subscriptionSelect,
              agency: { select: managedAgencySelect },
            },
          },
        },
      },
      agencyInvitationsAccepted: {
        where: { status: 'ACCEPTED' as const, isCurrentCommercial: true },
        orderBy: [
          { acceptedAt: 'desc' as const },
          { createdAt: 'desc' as const },
          { id: 'desc' as const },
        ],
        take: 1,
        select: {
          id: true,
          acceptedPlan: true,
          acceptedMembership: {
            select: {
              id: true,
              role: true,
              endedAt: true,
              agency: { select: managedAgencySelect },
              subscriptions: {
                where: { plan: 'AGENT_AGENCY_MEMBER' as const },
                orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
                take: 10,
                select: subscriptionSelect,
              },
            },
          },
        },
      },
      integrationSessions: {
        orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
        take: 5,
        select: {
          id: true,
          provider: true,
          status: true,
          lastConnectedAt: true,
          lastUsedAt: true,
          illustrationSsoReachable: true,
          illustrationSsoCheckedAt: true,
          updatedAt: true,
        },
      },
      messagingChannels: {
        orderBy: [{ updatedAt: 'desc' as const }, { id: 'desc' as const }],
        take: 10,
        select: {
          id: true,
          provider: true,
          kind: true,
          status: true,
          updatedAt: true,
        },
      },
      platformSubscriptions: {
        where: { plan: 'AGENT_INDIVIDUAL' as const },
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        take: 10,
        select: subscriptionSelect,
      },
      agencyMemberships: {
        where: { endedAt: null },
        orderBy: [{ joinedAt: 'desc' as const }, { id: 'desc' as const }],
        take: 5,
        select: {
          id: true,
          role: true,
          joinedAt: true,
          agency: {
            select: managedAgencySelect,
          },
          subscriptions: {
            where: { plan: 'AGENT_AGENCY_MEMBER' as const },
            orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
            take: 10,
            select: subscriptionSelect,
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect

type ManagedUserRecord = Prisma.UserGetPayload<{ select: typeof managedUserSelect }>
type SubscriptionRecord = ManagedUserRecord['agent'] extends infer AgentRecord
  ? AgentRecord extends { platformSubscriptions: Array<infer Subscription> }
    ? Subscription
    : never
  : never

function isCurrentSubscription(subscription: SubscriptionRecord, now: Date): boolean {
  if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIALING') return false
  return (
    subscription.currentPeriodStart !== null
    && subscription.currentPeriodEnd !== null
    && subscription.currentPeriodStart <= now
    && subscription.currentPeriodEnd > now
  )
}

function effectiveSubscriptionStatus(
  subscription: SubscriptionRecord,
  now: Date,
): PlatformSubscriptionStatus {
  if (
    (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING')
    && !isCurrentSubscription(subscription, now)
  ) {
    return 'EXPIRED'
  }
  return subscription.status
}

function selectSubscription(
  subscriptions: readonly SubscriptionRecord[],
  now: Date,
): SubscriptionRecord | null {
  return subscriptions.find((subscription) => subscription.status === 'ACTIVE' && isCurrentSubscription(subscription, now))
    ?? subscriptions.find((subscription) => subscription.status === 'TRIALING' && isCurrentSubscription(subscription, now))
    ?? subscriptions.find((subscription) => subscription.status === 'PAST_DUE')
    ?? subscriptions.find((subscription) => subscription.status === 'CANCELED')
    ?? subscriptions.find((subscription) => subscription.status === 'EXPIRED')
    ?? subscriptions[0]
    ?? null
}

function deriveCommercialContext(user: ManagedUserRecord, now: Date) {
  if (!user.agent) {
    return {
      plan: 'NOT_APPLICABLE' as const,
      subscription: null,
      agency: null,
      membershipRole: null,
    }
  }

  const currentInvitation = user.agent.agencyInvitationsAccepted[0] ?? null
  const invitedMembership = currentInvitation?.acceptedMembership ?? null
  if (currentInvitation?.acceptedPlan === 'AGENCY') {
    return {
      plan: 'AGENCY' as const,
      subscription: selectSubscription(invitedMembership?.agency.subscriptions ?? [], now),
      agency: invitedMembership?.agency ?? null,
      membershipRole: invitedMembership?.role ?? null,
    }
  }
  if (currentInvitation?.acceptedPlan === 'AGENT_AGENCY_MEMBER') {
    return {
      plan: 'AGENT_AGENCY_MEMBER' as const,
      subscription: selectSubscription(invitedMembership?.subscriptions ?? [], now),
      agency: invitedMembership?.agency ?? null,
      membershipRole: invitedMembership?.role ?? null,
    }
  }
  if (currentInvitation) {
    return {
      plan: 'NEEDS_REVIEW' as const,
      subscription: null,
      agency: invitedMembership?.agency ?? null,
      membershipRole: invitedMembership?.role ?? null,
    }
  }

  const provisionedAccess = user.agent.adminProvisionedAccess
  if (provisionedAccess) {
    const provisionedSubscription = provisionedAccess.platformSubscription
    return {
      plan: provisionedSubscription.plan,
      subscription: provisionedSubscription,
      agency: provisionedSubscription.plan === 'AGENCY'
        ? provisionedSubscription.agency
        : null,
      membershipRole: provisionedSubscription.plan === 'AGENCY'
        ? ('OWNER' as const)
        : null,
    }
  }

  const founder = user.agent.founderEnrollment
  if (founder?.accountType === 'AGENCY') {
    return {
      plan: 'AGENCY' as const,
      subscription: selectSubscription(founder.agency?.subscriptions ?? [], now),
      agency: founder.agency,
      membershipRole: founder.agency ? ('OWNER' as const) : null,
    }
  }
  if (founder?.accountType === 'AGENT') {
    return {
      plan: 'AGENT_INDIVIDUAL' as const,
      subscription: selectSubscription(user.agent.platformSubscriptions, now),
      agency: null,
      membershipRole: null,
    }
  }

  return {
    plan: 'LEGACY' as const,
    subscription: null,
    agency: null,
    membershipRole: null,
  }
}

export type AdminManagedUser = ReturnType<typeof presentManagedUser>

function presentManagedUser(user: ManagedUserRecord, now: Date) {
  const commercial = deriveCommercialContext(user, now)
  const currentInvitation = user.agent?.agencyInvitationsAccepted[0] ?? null
  const provisionedAccess = !currentInvitation
    ? user.agent?.adminProvisionedAccess ?? null
    : null
  const commercialStatus = commercial.subscription
    ? effectiveSubscriptionStatus(commercial.subscription, now)
    : null
  const productStatus = !user.agent
    ? ('NOT_APPLICABLE' as const)
    : commercial.plan === 'LEGACY'
      ? ('LEGACY' as const)
      : commercialStatus === 'ACTIVE'
        ? ('ACTIVE' as const)
        : commercialStatus === 'TRIALING'
          && (!provisionedAccess || provisionedAccess.paymentRequiredAt === null)
          ? ('TRIAL' as const)
          : ('PAYMENT_REQUIRED' as const)
  const productSource = currentInvitation
    ? ('AGENCY_INVITATION' as const)
    : provisionedAccess
      ? ('ADMIN_PROVISIONED' as const)
      : user.agent?.founderEnrollment
        ? ('FOUNDER' as const)
        : user.agent
          ? ('LEGACY' as const)
          : ('NOT_APPLICABLE' as const)
  const pendingEmailChangeExpiry = user.pendingEmailChange?.currentApprovedAt
    ? user.pendingEmailChange.newTokenExpiresAt
    : user.pendingEmailChange?.expiresAt
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accessStatus: user.banned ? ('SUSPENDED' as const) : ('ACTIVE' as const),
    banReason: user.banReason,
    banExpires: user.banExpires,
    language: user.language,
    timeZone: user.timeZone,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    pendingEmailChange: user.pendingEmailChange && pendingEmailChangeExpiry && pendingEmailChangeExpiry > now
      ? user.pendingEmailChange
      : null,
    sessions: user.sessions,
    sessionCount: user._count.sessions,
    lastSeenAt: user.sessions[0]?.updatedAt ?? null,
    calendarIntegrations: user.calendarIntegrations,
    schedulingPage: user.schedulingPage,
    plan: commercial.plan as AdminUserPlan,
    productAccess: {
      source: productSource,
      status: productStatus,
      managed: productSource === 'ADMIN_PROVISIONED',
      enabledModules: provisionedAccess ? [...provisionedAccess.modules] : null,
      paymentRequiredAt: provisionedAccess?.paymentRequiredAt ?? null,
      paymentReason: provisionedAccess?.paymentReason ?? null,
      provisionedBy: provisionedAccess?.provisionedBy ?? null,
      updatedBy: provisionedAccess?.updatedBy ?? null,
      createdAt: provisionedAccess?.createdAt ?? null,
      updatedAt: provisionedAccess?.updatedAt ?? null,
    },
    ownsActiveAgency: Boolean(
      user.agent?.agencyMemberships.some((membership) => membership.role === 'OWNER'),
    ),
    subscription: commercial.subscription
      ? {
          id: commercial.subscription.id,
          plan: commercial.subscription.plan,
          status: commercialStatus!,
          rawStatus: commercial.subscription.status,
          unitAmountCents: commercial.subscription.unitAmountCents,
          currency: commercial.subscription.currency,
          currentPeriodStart: commercial.subscription.currentPeriodStart,
          currentPeriodEnd: commercial.subscription.currentPeriodEnd,
          cancelAtPeriodEnd: commercial.subscription.cancelAtPeriodEnd,
          stripeCustomerLinked: Boolean(commercial.subscription.stripeCustomerId),
          stripeSubscriptionLinked: Boolean(commercial.subscription.stripeSubscriptionId),
          providerManaged: Boolean(
            commercial.subscription.stripeCustomerId
            || commercial.subscription.stripeSubscriptionId,
          ),
          createdAt: commercial.subscription.createdAt,
          updatedAt: commercial.subscription.updatedAt,
        }
      : null,
    agency: commercial.agency
      ? {
          id: commercial.agency.id,
          name: commercial.agency.name,
          parentAgency: commercial.agency.parentAgency,
          activeMemberCount: commercial.agency._count.memberships,
          childAgencyCount: commercial.agency._count.childAgencies,
          pendingInvitationCount: (commercial.agency.invitations ?? []).filter((invitation) =>
            invitation.expiresAt > now
            || (
              invitation.checkout?.status === 'PENDING'
              && invitation.checkout.checkoutExpiresAt > now
            ),
          ).length,
          membershipRole: commercial.membershipRole,
          updatedAt: commercial.agency.updatedAt,
        }
      : null,
    agent: user.agent
      ? {
          id: user.agent.id,
          rank: user.agent.rank,
          npn: user.agent.npn,
          phone: user.agent.phone,
          status: user.agent.status,
          promotionAccessScope: user.agent.promotionAccessScope,
          updatedAt: user.agent.updatedAt,
          parentAgent: user.agent.parentAgent
            ? { id: user.agent.parentAgent.id, name: user.agent.parentAgent.user.name }
            : null,
          counts: user.agent._count,
          onboarding: user.agent.onboarding,
          founderEnrollment: user.agent.founderEnrollment,
          integrationSessions: user.agent.integrationSessions,
          messagingChannels: user.agent.messagingChannels,
        }
      : null,
    client: user.client
      ? {
          id: user.client.id,
          name: user.client.name,
          email: user.client.email,
          phone: user.client.phone,
          createdAt: user.client.createdAt,
          updatedAt: user.client.updatedAt,
          assignedAgent: {
            id: user.client.assignedAgent.id,
            name: user.client.assignedAgent.user.name,
          },
          counts: user.client._count,
        }
      : null,
  }
}

export async function readAdminUserDirectory(
  filters: AdminUserDirectoryFilters,
  now = new Date(),
) {
  const where = buildAdminUserWhere(filters, now)
  const total = await prisma.user.count({ where })
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_USER_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * ADMIN_USER_PAGE_SIZE,
    take: ADMIN_USER_PAGE_SIZE,
    select: managedUserSelect,
  })

  return {
    rows: users.map((user) => presentManagedUser(user, now)),
    total,
    page,
    pageCount,
  }
}

export async function readAdminUserDirectorySummary(now = new Date()) {
  const attentionWhere = paymentAttentionCondition(now)
  const reviewWhere = planCondition('NEEDS_REVIEW')
  const [total, active, suspended, agents, agencies, attention, review, needsAttention] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { banned: false } }),
    prisma.user.count({ where: { banned: true } }),
    prisma.user.count({ where: { role: 'AGENT' } }),
    prisma.user.count({ where: planCondition('AGENCY') }),
    prisma.user.count({ where: attentionWhere }),
    prisma.user.count({ where: reviewWhere }),
    prisma.user.count({ where: { OR: [{ banned: true }, attentionWhere, reviewWhere] } }),
  ])
  return { total, active, suspended, agents, agencies, attention, review, needsAttention }
}

export async function readAdminManagedUser(userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: managedUserSelect,
  })
  if (!user) return null

  const [auditLogs, recentBookings] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: 'User', entityId: user.id },
          ...(user.agent ? [{ entity: 'Agent', entityId: user.agent.id }] : []),
          ...(user.client ? [{ entity: 'Client', entityId: user.client.id }] : []),
        ],
      },
      include: { user: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
    prisma.schedulingBooking.findMany({
      where: { ownerUserId: user.id },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        inviteeName: true,
        inviteeEmail: true,
      },
    }),
  ])

  return {
    ...presentManagedUser(user, now),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      actorName: log.user.name,
      action: log.action,
      before: log.before,
      after: log.after,
      createdAt: log.createdAt,
    })),
    recentBookings,
  }
}
