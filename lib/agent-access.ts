import 'server-only'

import { cache } from 'react'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import type { PlatformPlanName } from '@/lib/plans'

export const ENTITLING_PLATFORM_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE'] as const

export type EntitlingPlatformSubscriptionStatus =
  (typeof ENTITLING_PLATFORM_SUBSCRIPTION_STATUSES)[number]

export type PlatformSubscriptionStatusName =
  | EntitlingPlatformSubscriptionStatus
  | 'PAST_DUE'
  | 'CANCELED'
  | 'EXPIRED'

export type AgentAccessKind = 'INDIVIDUAL' | 'AGENCY_MEMBER' | 'AGENCY_OWNER'

export type AgencyCapability =
  | 'MANAGE_TEAM'
  | 'VIEW_TEAM_DATA'
  | 'INVITE_AGENTS'
  | 'VIEW_TEAM_SUBSCRIPTIONS'
  | 'VIEW_AGENCY_NATIONAL_LIFE'

type AccessSubscription = {
  id: string
  plan: PlatformPlanName
  status: PlatformSubscriptionStatusName
  unitAmountCents: number
  currency: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

type AccessAgency = {
  id: string
  name: string
}

type AccessMembership = {
  id: string
  role: 'OWNER' | 'MEMBER'
  joinedAt: Date
}

export type AgentAccessContext = {
  agentId: string
  isActive: boolean
  kind: AgentAccessKind
  agencyId: string | null
  agencyName: string | null
  subscriptionStatus: PlatformSubscriptionStatusName | null
  agency: AccessAgency | null
  membership: AccessMembership | null
  subscription: AccessSubscription | null
  canManageTeam: boolean
  canViewTeamData: boolean
  canInviteAgents: boolean
  canViewTeamSubscriptions: boolean
  canViewAgencyNationalLife: boolean
  scopeAgentIds: string[]
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
} as const

function individualAccess(
  agentId: string,
  subscription: AccessSubscription | null,
  isActive = true,
): AgentAccessContext {
  return {
    agentId,
    isActive,
    kind: 'INDIVIDUAL',
    agencyId: null,
    agencyName: null,
    subscriptionStatus: subscription?.status ?? null,
    agency: null,
    membership: null,
    subscription,
    canManageTeam: false,
    canViewTeamData: false,
    canInviteAgents: false,
    canViewTeamSubscriptions: false,
    canViewAgencyNationalLife: false,
    scopeAgentIds: [agentId],
  }
}

function agencyAccess(input: {
  agentId: string
  kind: Exclude<AgentAccessKind, 'INDIVIDUAL'>
  agency: AccessAgency
  membership: AccessMembership
  subscription: AccessSubscription | null
  entitled: boolean
  scopeAgentIds: string[]
}): AgentAccessContext {
  const isEntitledOwner = input.kind === 'AGENCY_OWNER' && input.entitled
  const canInviteAgents = input.entitled

  return {
    agentId: input.agentId,
    isActive: true,
    kind: input.kind,
    agencyId: input.agency.id,
    agencyName: input.agency.name,
    subscriptionStatus: input.subscription?.status ?? null,
    agency: input.agency,
    membership: input.membership,
    subscription: input.subscription,
    canManageTeam: isEntitledOwner,
    canViewTeamData: isEntitledOwner,
    // An entitled member may grow their own branch, but team data and
    // management remain exclusive to the agency owner.
    canInviteAgents,
    canViewTeamSubscriptions: isEntitledOwner,
    canViewAgencyNationalLife: isEntitledOwner,
    // Invited members keep an individual data boundary even though their
    // commercial subscription remains linked to the agency membership.
    scopeAgentIds: isEntitledOwner ? input.scopeAgentIds : [input.agentId],
  }
}

function isEntitlingSubscription(
  subscription: AccessSubscription | null,
): subscription is AccessSubscription & {
  status: EntitlingPlatformSubscriptionStatus
} {
  if (
    subscription === null
    || !ENTITLING_PLATFORM_SUBSCRIPTION_STATUSES.includes(
      subscription.status as EntitlingPlatformSubscriptionStatus,
    )
  ) {
    return false
  }

  const now = Date.now()
  return (
    (subscription.currentPeriodStart === null
      || subscription.currentPeriodStart.getTime() <= now)
    && (subscription.currentPeriodEnd === null
      || subscription.currentPeriodEnd.getTime() > now)
  )
}

/**
 * Billing history is newest-first, but a newer canceled row must never hide a
 * still-current entitlement. Prefer the current row and fall back to the most
 * recent historical row only for status/identity copy in the plan UI.
 */
function selectAccessSubscription(
  subscriptions: readonly AccessSubscription[],
): AccessSubscription | null {
  return subscriptions.find((subscription) =>
    isEntitlingSubscription(subscription),
  ) ?? subscriptions[0] ?? null
}

/**
 * Resolves commercial capabilities without consulting the legacy hierarchy.
 *
 * A missing, overdue, canceled, or expired subscription grants no agency
 * capability. The fail-closed fallback still lets the signed-in agent work on
 * their own records so additive rollouts do not expose another producer's data.
 */
export async function getAgentAccessForAgent(agentId: string): Promise<AgentAccessContext> {
  const [subject, membership, individualSubscriptions] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { status: true },
    }),
    prisma.agencyMembership.findFirst({
      where: { agentId, endedAt: null },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        role: true,
        joinedAt: true,
        agency: {
          select: {
            id: true,
            name: true,
            subscriptions: {
              where: { plan: 'AGENCY' },
              orderBy: { createdAt: 'desc' },
              select: subscriptionSelect,
            },
          },
        },
        subscriptions: {
          where: { plan: 'AGENT_AGENCY_MEMBER' },
          orderBy: { createdAt: 'desc' },
          select: subscriptionSelect,
        },
      },
    }),
    prisma.platformSubscription.findMany({
      where: {
        agentId,
        plan: 'AGENT_INDIVIDUAL',
      },
      orderBy: { createdAt: 'desc' },
      select: subscriptionSelect,
    }),
  ])

  if (!subject || subject.status !== 'ACTIVE') {
    return individualAccess(agentId, null, false)
  }

  if (!membership) {
    return individualAccess(
      agentId,
      selectAccessSubscription(individualSubscriptions),
    )
  }

  const accessMembership: AccessMembership = {
    id: membership.id,
    role: membership.role,
    joinedAt: membership.joinedAt,
  }
  const agency: AccessAgency = {
    id: membership.agency.id,
    name: membership.agency.name,
  }

  if (membership.role === 'MEMBER') {
    const memberSubscription = selectAccessSubscription(membership.subscriptions)

    return agencyAccess({
      agentId,
      kind: 'AGENCY_MEMBER',
      agency,
      membership: accessMembership,
      subscription: memberSubscription,
      entitled: isEntitlingSubscription(memberSubscription),
      scopeAgentIds: [agentId],
    })
  }

  const agencySubscription = selectAccessSubscription(
    membership.agency.subscriptions,
  )
  if (!isEntitlingSubscription(agencySubscription)) {
    return agencyAccess({
      agentId,
      kind: 'AGENCY_OWNER',
      agency,
      membership: accessMembership,
      subscription: agencySubscription,
      entitled: false,
      scopeAgentIds: [agentId],
    })
  }

  const now = new Date()
  const activeMembers = await prisma.agencyMembership.findMany({
    where: {
      agencyId: membership.agency.id,
      role: 'MEMBER',
      endedAt: null,
      agent: { status: 'ACTIVE' },
      subscriptions: {
        some: {
          plan: 'AGENT_AGENCY_MEMBER',
          status: { in: [...ENTITLING_PLATFORM_SUBSCRIPTION_STATUSES] },
          AND: [
            {
              OR: [
                { currentPeriodStart: null },
                { currentPeriodStart: { lte: now } },
              ],
            },
            {
              OR: [
                { currentPeriodEnd: null },
                { currentPeriodEnd: { gt: now } },
              ],
            },
          ],
        },
      },
    },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: { agentId: true },
  })

  // The owner always retains their own boundary even if an inconsistent legacy
  // row omitted the OWNER membership from the active-member query.
  const scopeAgentIds = [
    agentId,
    ...activeMembers.map(({ agentId: memberAgentId }) => memberAgentId),
  ].filter((id, index, ids) => ids.indexOf(id) === index)

  return agencyAccess({
    agentId,
    kind: 'AGENCY_OWNER',
    agency,
    membership: accessMembership,
    subscription: agencySubscription,
    entitled: true,
    scopeAgentIds,
  })
}

const getCachedCurrentAgentAccess = cache(async (): Promise<AgentAccessContext> => {
  const agent = await getCurrentAgent()
  return getAgentAccessForAgent(agent.id)
})

export async function getCurrentAgentAccess(): Promise<AgentAccessContext> {
  return getCachedCurrentAgentAccess()
}

export async function getAgentScopeIds(agentId?: string): Promise<string[]> {
  const access = agentId
    ? await getAgentAccessForAgent(agentId)
    : await getCurrentAgentAccess()

  return [...access.scopeAgentIds]
}

const CAPABILITY_ALLOWED: Record<AgencyCapability, keyof AgentAccessContext> = {
  MANAGE_TEAM: 'canManageTeam',
  VIEW_TEAM_DATA: 'canViewTeamData',
  INVITE_AGENTS: 'canInviteAgents',
  VIEW_TEAM_SUBSCRIPTIONS: 'canViewTeamSubscriptions',
  VIEW_AGENCY_NATIONAL_LIFE: 'canViewAgencyNationalLife',
}

export async function requireAgencyCapability(
  capability: AgencyCapability = 'MANAGE_TEAM',
  agentId?: string,
): Promise<AgentAccessContext> {
  const access = agentId
    ? await getAgentAccessForAgent(agentId)
    : await getCurrentAgentAccess()
  const accessField = CAPABILITY_ALLOWED[capability]

  if (access[accessField] !== true) {
    throw new Error(`Forbidden: agency capability ${capability} required`)
  }

  return access
}
