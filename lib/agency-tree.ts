import 'server-only'

import type {
  AgencyRecruitmentStage,
  PlatformSubscriptionStatus,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'

export type AgencyTreeNodeKind = 'SELF' | 'AGENT' | 'AGENCY'
export type AgencyTreeSubscriptionStatus = PlatformSubscriptionStatus | 'NO_SUBSCRIPTION'

/**
 * A name-only commercial hierarchy node. This shape deliberately excludes
 * client, policy, commission, and National Life data: discovering a roster is
 * not authorization to read the descendant's operational records.
 */
export type AgencyTreeNode = {
  agentId: string
  name: string
  parentAgentId: string | null
  depth: number
  kind: AgencyTreeNodeKind
  agencyId: string
  agencyName: string
  subscriptionStatus: AgencyTreeSubscriptionStatus
  recruitmentStage: AgencyRecruitmentStage | null
}

type ActiveAgency = {
  agencyId: string
  agencyName: string
  parentAgencyId: string | null
  depth: number
  owner: {
    membershipId: string
    agentId: string
    name: string
    parentAgentId: string | null
    invitedByAgentId: string | null
    joinedAt: Date
    subscriptionStatus: AgencyTreeSubscriptionStatus
    recruitmentStage: AgencyRecruitmentStage | null
  }
}

type OrderedNode = AgencyTreeNode & {
  sortAt: Date
  sortId: string
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE'] as const

function requireValidDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) {
    throw new RangeError('now must be a valid Date')
  }
}

function activeSubscriptionWhere(
  plan: 'AGENCY' | 'AGENT_AGENCY_MEMBER',
  now: Date,
): Prisma.PlatformSubscriptionWhereInput {
  return {
    plan,
    status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
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
  }
}

function isActiveSubscriptionStatus(
  value: string,
): value is Extract<AgencyTreeSubscriptionStatus, 'TRIALING' | 'ACTIVE'> {
  return value === 'TRIALING' || value === 'ACTIVE'
}

function latestSubscriptionStatus(
  subscription: {
    status: PlatformSubscriptionStatus
    currentPeriodStart?: Date | null
    currentPeriodEnd?: Date | null
  } | undefined,
  now: Date,
): AgencyTreeSubscriptionStatus {
  if (!subscription) return 'NO_SUBSCRIPTION'

  if (
    isActiveSubscriptionStatus(subscription.status)
    && (
      (subscription.currentPeriodStart && subscription.currentPeriodStart > now)
      || (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now)
    )
  ) {
    return 'EXPIRED'
  }

  return subscription.status
}

function compareOrderedNodes(left: OrderedNode, right: OrderedNode): number {
  const byTime = left.sortAt.getTime() - right.sortAt.getTime()
  if (byTime !== 0) return byTime
  return left.sortId.localeCompare(right.sortId)
}

/**
 * Returns the active, commercial name tree rooted at one agency owner.
 *
 * Agency.parentAgencyId is the commercial authorization boundary. Inside that
 * already-authorized subtree, Agent.parentAgentId restores the inviter's named
 * branch only when both agents belong to the expected agency. Corrupt, cyclic,
 * or cross-agency links are normalized to that agency's owner.
 *
 * This is a roster helper, not a data-scope helper. Callers must not substitute
 * its agent IDs for AgentAccessContext.scopeAgentIds.
 */
export async function getAgencyTreeForAgent(
  agentId: string,
  now = new Date(),
): Promise<AgencyTreeNode[]> {
  requireValidDate(now)

  const rootMembership = await prisma.agencyMembership.findFirst({
    where: {
      agentId,
      role: 'OWNER',
      endedAt: null,
      agent: { status: 'ACTIVE' },
    },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      agentId: true,
      invitedByAgentId: true,
      joinedAt: true,
      agent: {
        select: {
          parentAgentId: true,
          user: { select: { name: true } },
        },
      },
      agency: {
        select: {
          id: true,
          name: true,
          subscriptions: {
            where: activeSubscriptionWhere('AGENCY', now),
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  })

  const rootSubscription = rootMembership?.agency.subscriptions[0]
  if (
    !rootMembership
    || !rootSubscription
    || !isActiveSubscriptionStatus(rootSubscription.status)
  ) {
    return []
  }

  const rootAgency: ActiveAgency = {
    agencyId: rootMembership.agency.id,
    agencyName: rootMembership.agency.name,
    parentAgencyId: null,
    depth: 0,
    owner: {
      membershipId: rootMembership.id,
      agentId: rootMembership.agentId,
      name: rootMembership.agent.user.name,
      parentAgentId: rootMembership.agent.parentAgentId,
      invitedByAgentId: rootMembership.invitedByAgentId,
      joinedAt: rootMembership.joinedAt,
      subscriptionStatus: rootSubscription.status,
      // Re-rooting the tree must not reveal the recruitment label assigned by
      // an ancestor agency to the current owner.
      recruitmentStage: null,
    },
  }

  const agencies = new Map<string, ActiveAgency>([
    [rootAgency.agencyId, rootAgency],
  ])
  const visitedAgencyIds = new Set<string>([rootAgency.agencyId])
  const visibleOwnerAgentIds = new Set<string>([rootAgency.owner.agentId])
  let frontier = [rootAgency.agencyId]

  // Traverse one commercial generation at a time. Candidate child agencies
  // are admitted only when their active OWNER membership was accepted by an
  // AGENCY invitation issued by the exact parent agency.
  while (frontier.length > 0) {
    const candidates = await prisma.agency.findMany({
      where: { parentAgencyId: { in: frontier } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        parentAgencyId: true,
        memberships: {
          where: {
            role: 'OWNER',
            endedAt: null,
            agent: { status: 'ACTIVE' },
          },
          orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            agentId: true,
            invitedByAgentId: true,
            joinedAt: true,
            agent: {
              select: {
                parentAgentId: true,
                user: { select: { name: true } },
              },
            },
            acceptedInvitation: {
              select: {
                agencyId: true,
                acceptedAgentId: true,
                acceptedPlan: true,
                status: true,
                recruitmentStage: true,
              },
            },
          },
        },
        subscriptions: {
          where: { plan: 'AGENCY' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
          },
        },
      },
    })

    const nextFrontier: string[] = []
    for (const candidate of candidates) {
      if (
        candidate.parentAgencyId === null
        || visitedAgencyIds.has(candidate.id)
      ) {
        continue
      }

      const parent = agencies.get(candidate.parentAgencyId)
      const owner = candidate.memberships[0]
      const subscription = candidate.subscriptions[0]
      const invitation = owner?.acceptedInvitation

      if (
        !parent
        || !owner
        || visibleOwnerAgentIds.has(owner.agentId)
        || !invitation
        || invitation.status !== 'ACCEPTED'
        || invitation.acceptedPlan !== 'AGENCY'
        || invitation.agencyId !== candidate.parentAgencyId
        || invitation.acceptedAgentId !== owner.agentId
      ) {
        continue
      }

      const activeAgency: ActiveAgency = {
        agencyId: candidate.id,
        agencyName: candidate.name,
        parentAgencyId: candidate.parentAgencyId,
        depth: parent.depth + 1,
        owner: {
          membershipId: owner.id,
          agentId: owner.agentId,
          name: owner.agent.user.name,
          parentAgentId: owner.agent.parentAgentId,
          invitedByAgentId: owner.invitedByAgentId,
          joinedAt: owner.joinedAt,
          subscriptionStatus: latestSubscriptionStatus(subscription, now),
          recruitmentStage: invitation.recruitmentStage,
        },
      }

      agencies.set(activeAgency.agencyId, activeAgency)
      visitedAgencyIds.add(activeAgency.agencyId)
      visibleOwnerAgentIds.add(activeAgency.owner.agentId)
      nextFrontier.push(activeAgency.agencyId)
    }

    frontier = nextFrontier
  }

  const visibleAgencyIds = [...agencies.keys()]
  const members = await prisma.agencyMembership.findMany({
    where: {
      agencyId: { in: visibleAgencyIds },
      role: 'MEMBER',
      endedAt: null,
      agent: { status: 'ACTIVE' },
    },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      agencyId: true,
      agentId: true,
      invitedByAgentId: true,
      joinedAt: true,
      agent: {
        select: {
          parentAgentId: true,
          user: { select: { name: true } },
        },
      },
      acceptedInvitation: {
        select: {
          agencyId: true,
          acceptedAgentId: true,
          acceptedPlan: true,
          status: true,
          recruitmentStage: true,
        },
      },
      subscriptions: {
        where: { plan: 'AGENT_AGENCY_MEMBER' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
        },
      },
    },
  })

  const rootNode: OrderedNode = {
    agentId: rootAgency.owner.agentId,
    name: rootAgency.owner.name,
    parentAgentId: null,
    depth: 0,
    kind: 'SELF',
    agencyId: rootAgency.agencyId,
    agencyName: rootAgency.agencyName,
    subscriptionStatus: rootAgency.owner.subscriptionStatus,
    recruitmentStage: rootAgency.owner.recruitmentStage,
    sortAt: rootAgency.owner.joinedAt,
    sortId: rootAgency.owner.membershipId,
  }

  const childrenByAgentId = new Map<string, OrderedNode[]>()
  const addChild = (parentAgentId: string, child: OrderedNode) => {
    const children = childrenByAgentId.get(parentAgentId) ?? []
    children.push(child)
    childrenByAgentId.set(parentAgentId, children)
  }

  // Each agent may occupy only one visible commercial node. If legacy or
  // corrupt rows duplicate an active membership, keep the first deterministic
  // row and never use the duplicate as hierarchy authority.
  const claimedAgentIds = new Set(
    [...agencies.values()].map((agency) => agency.owner.agentId),
  )
  const validMembers: typeof members = []
  for (const member of members) {
    const agency = agencies.get(member.agencyId)
    if (!agency || claimedAgentIds.has(member.agentId)) continue

    // New accepted memberships carry a one-to-one invitation. Rows created by
    // the pre-invitation rollout have no relation and remain visible; a present
    // but inconsistent relation fails closed.
    const invitation = member.acceptedInvitation
    if (
      invitation
      && (
        invitation.status !== 'ACCEPTED'
        || invitation.acceptedPlan !== 'AGENT_AGENCY_MEMBER'
        || invitation.agencyId !== member.agencyId
        || invitation.acceptedAgentId !== member.agentId
      )
    ) {
      continue
    }

    claimedAgentIds.add(member.agentId)
    validMembers.push(member)
  }

  const agentAgencyById = new Map<string, string>()
  for (const agency of agencies.values()) {
    agentAgencyById.set(agency.owner.agentId, agency.agencyId)
  }
  for (const member of validMembers) {
    agentAgencyById.set(member.agentId, member.agencyId)
  }

  const requestedMemberParentById = new Map<string, string>()
  for (const member of validMembers) {
    const agency = agencies.get(member.agencyId)
    if (!agency) continue

    // Agent.parentAgentId is the durable hierarchy edge. invitedByAgentId is a
    // compatibility fallback for rows created before that edge was persisted.
    const requestedParentAgentId =
      member.agent.parentAgentId ?? member.invitedByAgentId
    const normalizedParentAgentId =
      requestedParentAgentId
      && requestedParentAgentId !== member.agentId
      && agentAgencyById.get(requestedParentAgentId) === member.agencyId
        ? requestedParentAgentId
        : agency.owner.agentId
    requestedMemberParentById.set(member.agentId, normalizedParentAgentId)
  }

  const memberChainReachesOwner = (memberAgentId: string): boolean => {
    const agencyId = agentAgencyById.get(memberAgentId)
    const agency = agencyId ? agencies.get(agencyId) : undefined
    if (!agency) return false

    const seen = new Set<string>()
    let cursor = memberAgentId
    while (cursor !== agency.owner.agentId) {
      if (seen.has(cursor)) return false
      seen.add(cursor)

      const parentAgentId = requestedMemberParentById.get(cursor)
      if (
        !parentAgentId
        || agentAgencyById.get(parentAgentId) !== agency.agencyId
      ) {
        return false
      }
      cursor = parentAgentId
    }
    return true
  }

  const normalizedMemberParentById = new Map<string, string>()
  for (const member of validMembers) {
    const agency = agencies.get(member.agencyId)
    if (!agency) continue
    normalizedMemberParentById.set(
      member.agentId,
      memberChainReachesOwner(member.agentId)
        ? requestedMemberParentById.get(member.agentId) ?? agency.owner.agentId
        : agency.owner.agentId,
    )
  }

  for (const agency of agencies.values()) {
    if (agency.agencyId === rootAgency.agencyId) continue

    const parent = agency.parentAgencyId
      ? agencies.get(agency.parentAgencyId)
      : undefined
    if (!parent) continue

    const requestedParentAgentId =
      agency.owner.parentAgentId ?? agency.owner.invitedByAgentId
    // A subagency may hang below the exact member who invited it, but that
    // inviter must belong to the immediate parent agency. Otherwise the edge
    // is normalized to the parent owner and cannot escape the tenant boundary.
    const normalizedParentAgentId =
      requestedParentAgentId
      && agentAgencyById.get(requestedParentAgentId) === parent.agencyId
        ? requestedParentAgentId
        : parent.owner.agentId

    addChild(normalizedParentAgentId, {
      agentId: agency.owner.agentId,
      name: agency.owner.name,
      parentAgentId: normalizedParentAgentId,
      depth: agency.depth,
      kind: 'AGENCY',
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      subscriptionStatus: agency.owner.subscriptionStatus,
      recruitmentStage: agency.owner.recruitmentStage,
      sortAt: agency.owner.joinedAt,
      sortId: agency.owner.membershipId,
    })
  }

  for (const member of validMembers) {
    const agency = agencies.get(member.agencyId)
    const subscription = member.subscriptions[0]
    if (!agency) continue
    const invitation = member.acceptedInvitation
    const normalizedParentAgentId =
      normalizedMemberParentById.get(member.agentId) ?? agency.owner.agentId
    addChild(normalizedParentAgentId, {
      agentId: member.agentId,
      name: member.agent.user.name,
      parentAgentId: normalizedParentAgentId,
      depth: agency.depth + 1,
      kind: 'AGENT',
      agencyId: agency.agencyId,
      agencyName: agency.agencyName,
      subscriptionStatus: latestSubscriptionStatus(subscription, now),
      recruitmentStage: invitation?.recruitmentStage ?? null,
      sortAt: member.joinedAt,
      sortId: member.id,
    })
  }

  for (const children of childrenByAgentId.values()) {
    children.sort(compareOrderedNodes)
  }

  const result: AgencyTreeNode[] = []
  const visitedAgentIds = new Set<string>()
  const visit = (node: OrderedNode, depth: number) => {
    if (visitedAgentIds.has(node.agentId)) return
    visitedAgentIds.add(node.agentId)

    result.push({
      agentId: node.agentId,
      name: node.name,
      parentAgentId: node.parentAgentId,
      depth,
      kind: node.kind,
      agencyId: node.agencyId,
      agencyName: node.agencyName,
      subscriptionStatus: node.subscriptionStatus,
      recruitmentStage: node.recruitmentStage,
    })
    for (const child of childrenByAgentId.get(node.agentId) ?? []) {
      visit(child, depth + 1)
    }
  }

  visit(rootNode, 0)
  return result
}
