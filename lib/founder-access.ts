import 'server-only'

import { prisma } from '@/lib/prisma'
import type { PlatformPlanName } from '@/lib/plans'

export const FOUNDER_TRIAL_DURATION_SECONDS = 2_592_000
export const FOUNDER_TRIAL_DURATION_MS = FOUNDER_TRIAL_DURATION_SECONDS * 1_000

export type FounderAccessState = 'LEGACY' | 'TRIAL' | 'PAID' | 'EXPIRED'
export type FounderAccountTypeName = 'AGENT' | 'AGENCY'
export type FounderAccessSource = 'LEGACY' | 'FOUNDER' | 'AGENCY_INVITATION'

export type FounderAccessSubscription = {
  id: string
  plan: 'AGENT_INDIVIDUAL' | 'AGENCY' | 'AGENT_AGENCY_MEMBER'
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  unitAmountCents: number
  currency: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export type FounderAccessResolution = {
  state: FounderAccessState
  hasAccess: boolean
  source: FounderAccessSource
  requiredPlan: PlatformPlanName | null
  founderEnrollmentId: string | null
  agencyInvitationId: string | null
  invitingAgencyName: string | null
  accountType: FounderAccountTypeName | null
  cohort: string | null
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  subscription: FounderAccessSubscription | null
}

type FounderEnrollmentRecord = {
  id: string
  agentId: string
  agencyId: string | null
  accountType: FounderAccountTypeName
  cohort: string
  trialStartedAt: Date
  trialEndsAt: Date
}

type AcceptedAgencyInvitationRecord = {
  id: string
  agencyId: string
  acceptedAgentId: string | null
  acceptedPlan: PlatformPlanName | null
  agency: { name: string }
  acceptedMembership: {
    id: string
    agentId: string
    agencyId: string
    role: 'OWNER' | 'MEMBER'
    endedAt: Date | null
    agency: { parentAgencyId: string | null }
  } | null
}

const founderEnrollmentSelect = {
  id: true,
  agentId: true,
  agencyId: true,
  accountType: true,
  cohort: true,
  trialStartedAt: true,
  trialEndsAt: true,
} as const

const acceptedAgencyInvitationSelect = {
  id: true,
  agencyId: true,
  acceptedAgentId: true,
  acceptedPlan: true,
  agency: { select: { name: true } },
  acceptedMembership: {
    select: {
      id: true,
      agentId: true,
      agencyId: true,
      role: true,
      endedAt: true,
      agency: { select: { parentAgencyId: true } },
    },
  },
} as const

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

function requireValidDate(value: Date, label: string): number {
  const timestamp = value.getTime()
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`${label} must be a valid Date`)
  }
  return timestamp
}

/**
 * Returns an exact 720-hour trial boundary. Millisecond arithmetic is
 * deliberate: calendar-day mutation would vary when a period crosses DST.
 */
export function calculateFounderTrialEnd(trialStartedAt: Date): Date {
  const startedAt = requireValidDate(trialStartedAt, 'trialStartedAt')
  return new Date(startedAt + FOUNDER_TRIAL_DURATION_MS)
}

function isWithinRequiredPeriod(
  subscription: FounderAccessSubscription,
  nowTimestamp: number,
): boolean {
  if (!subscription.currentPeriodStart || !subscription.currentPeriodEnd) {
    return false
  }

  const startsAt = subscription.currentPeriodStart.getTime()
  const endsAt = subscription.currentPeriodEnd.getTime()
  return (
    Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && startsAt <= nowTimestamp
    && endsAt > nowTimestamp
  )
}

function isWithinExactFounderTrial(
  founder: FounderEnrollmentRecord,
  nowTimestamp: number,
): boolean {
  const startsAt = founder.trialStartedAt.getTime()
  const endsAt = founder.trialEndsAt.getTime()

  return (
    Number.isFinite(startsAt)
    && Number.isFinite(endsAt)
    && endsAt - startsAt === FOUNDER_TRIAL_DURATION_MS
    && startsAt <= nowTimestamp
    && endsAt > nowTimestamp
  )
}

function legacyAccess(): FounderAccessResolution {
  return {
    state: 'LEGACY',
    hasAccess: true,
    source: 'LEGACY',
    requiredPlan: null,
    founderEnrollmentId: null,
    agencyInvitationId: null,
    invitingAgencyName: null,
    accountType: null,
    cohort: null,
    trialStartedAt: null,
    trialEndsAt: null,
    subscription: null,
  }
}

function founderAccess(
  founder: FounderEnrollmentRecord,
  state: Exclude<FounderAccessState, 'LEGACY'>,
  requiredPlan: Extract<PlatformPlanName, 'AGENT_INDIVIDUAL' | 'AGENCY'>,
  subscription: FounderAccessSubscription | null,
): FounderAccessResolution {
  return {
    state,
    hasAccess: state === 'TRIAL' || state === 'PAID',
    source: 'FOUNDER',
    requiredPlan,
    founderEnrollmentId: founder.id,
    agencyInvitationId: null,
    invitingAgencyName: null,
    accountType: founder.accountType,
    cohort: founder.cohort,
    trialStartedAt: founder.trialStartedAt,
    trialEndsAt: founder.trialEndsAt,
    subscription,
  }
}

function invitationAccess(
  invitation: AcceptedAgencyInvitationRecord,
  state: Exclude<FounderAccessState, 'LEGACY'>,
  subscription: FounderAccessSubscription | null,
): FounderAccessResolution {
  const requiredPlan = invitation.acceptedPlan === 'AGENCY'
    || invitation.acceptedPlan === 'AGENT_AGENCY_MEMBER'
    ? invitation.acceptedPlan
    : null

  return {
    state,
    hasAccess: state === 'TRIAL' || state === 'PAID',
    source: 'AGENCY_INVITATION',
    requiredPlan,
    founderEnrollmentId: null,
    agencyInvitationId: invitation.id,
    invitingAgencyName: invitation.agency.name,
    accountType: requiredPlan === 'AGENCY'
      ? 'AGENCY'
      : requiredPlan === 'AGENT_AGENCY_MEMBER'
        ? 'AGENT'
        : null,
    cohort: null,
    trialStartedAt: null,
    trialEndsAt: null,
    subscription,
  }
}

function invitationSubscriptionSubject(
  invitation: AcceptedAgencyInvitationRecord,
  agentId: string,
):
  | { agencyMembershipId: string; plan: 'AGENT_AGENCY_MEMBER' }
  | { agencyId: string; plan: 'AGENCY' }
  | null {
  const membership = invitation.acceptedMembership
  if (
    !membership
    || membership.endedAt !== null
    || membership.agentId !== agentId
    || invitation.acceptedAgentId !== agentId
  ) {
    return null
  }

  if (invitation.acceptedPlan === 'AGENT_AGENCY_MEMBER') {
    return membership.role === 'MEMBER'
      && membership.agencyId === invitation.agencyId
      ? { agencyMembershipId: membership.id, plan: 'AGENT_AGENCY_MEMBER' }
      : null
  }

  if (invitation.acceptedPlan === 'AGENCY') {
    return membership.role === 'OWNER'
      && membership.agency.parentAgencyId === invitation.agencyId
      ? { agencyId: membership.agencyId, plan: 'AGENCY' }
      : null
  }

  return null
}

async function resolveAgencyInvitationAccess(
  invitation: AcceptedAgencyInvitationRecord,
  agentId: string,
  nowTimestamp: number,
): Promise<FounderAccessResolution> {
  const subjectWhere = invitationSubscriptionSubject(invitation, agentId)
  if (!subjectWhere) return invitationAccess(invitation, 'EXPIRED', null)

  const subscriptions = await prisma.platformSubscription.findMany({
    where: subjectWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 25,
    select: subscriptionSelect,
  })

  const paidSubscription = subscriptions.find((subscription) => (
    subscription.status === 'ACTIVE'
    && isWithinRequiredPeriod(subscription, nowTimestamp)
  ))
  if (paidSubscription) {
    return invitationAccess(invitation, 'PAID', paidSubscription)
  }

  const trialSubscription = subscriptions.find((subscription) => (
    subscription.status === 'TRIALING'
    && isWithinRequiredPeriod(subscription, nowTimestamp)
  ))
  if (trialSubscription) {
    return invitationAccess(invitation, 'TRIAL', trialSubscription)
  }

  return invitationAccess(invitation, 'EXPIRED', subscriptions[0] ?? null)
}

/**
 * Resolves the additive commercial boundary independently from the legacy
 * access resolver. Accounts without a Founder enrollment or accepted agency
 * invitation remain grandfathered. An accepted invitation takes precedence
 * because it identifies the person's current, exact commercial subject.
 */
export async function resolveFounderAccessForAgent(
  agentId: string,
  now = new Date(),
): Promise<FounderAccessResolution> {
  const nowTimestamp = requireValidDate(now, 'now')
  const [founder, acceptedInvitation] = await Promise.all([
    prisma.founderEnrollment.findUnique({
      where: { agentId },
      select: founderEnrollmentSelect,
    }),
    prisma.agencyInvitation.findFirst({
      where: {
        acceptedAgentId: agentId,
        status: 'ACCEPTED',
      },
      orderBy: [{ acceptedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: acceptedAgencyInvitationSelect,
    }),
  ])

  if (acceptedInvitation) {
    return resolveAgencyInvitationAccess(
      acceptedInvitation,
      agentId,
      nowTimestamp,
    )
  }

  if (!founder) return legacyAccess()

  let subjectWhere:
    | { agentId: string; plan: 'AGENT_INDIVIDUAL' }
    | { agencyId: string; plan: 'AGENCY' }

  if (founder.accountType === 'AGENT' && founder.agencyId === null) {
    subjectWhere = { agentId, plan: 'AGENT_INDIVIDUAL' }
  } else if (founder.accountType === 'AGENCY' && founder.agencyId !== null) {
    subjectWhere = { agencyId: founder.agencyId, plan: 'AGENCY' }
  } else {
    // The database constraint rejects this shape. Keep the runtime boundary
    // fail-closed in case malformed historical data reaches the resolver.
    const malformedPlan = founder.accountType === 'AGENCY'
      ? 'AGENCY'
      : 'AGENT_INDIVIDUAL'
    return founderAccess(founder, 'EXPIRED', malformedPlan, null)
  }

  const subscriptions = await prisma.platformSubscription.findMany({
    where: subjectWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 25,
    select: subscriptionSelect,
  })

  const paidSubscription = subscriptions.find((subscription) => (
    subscription.status === 'ACTIVE'
    && isWithinRequiredPeriod(subscription, nowTimestamp)
  ))
  if (paidSubscription) {
    return founderAccess(founder, 'PAID', subjectWhere.plan, paidSubscription)
  }

  const trialSubscription = subscriptions.find((subscription) => (
    subscription.status === 'TRIALING'
    && isWithinRequiredPeriod(subscription, nowTimestamp)
  ))
  if (
    trialSubscription
    && isWithinExactFounderTrial(founder, nowTimestamp)
  ) {
    return founderAccess(founder, 'TRIAL', subjectWhere.plan, trialSubscription)
  }

  return founderAccess(
    founder,
    'EXPIRED',
    subjectWhere.plan,
    subscriptions[0] ?? null,
  )
}

export class FounderAccessRequiredError extends Error {
  readonly code = 'FOUNDER_ACCESS_REQUIRED'
  readonly access: FounderAccessResolution

  constructor(access: FounderAccessResolution) {
    super('Platform access requires a current trial or paid subscription')
    this.name = 'FounderAccessRequiredError'
    this.access = access
  }
}

export async function requireFounderAccessForAgent(
  agentId: string,
  now = new Date(),
): Promise<FounderAccessResolution> {
  const access = await resolveFounderAccessForAgent(agentId, now)
  if (!access.hasAccess) throw new FounderAccessRequiredError(access)
  return access
}

/**
 * Role guards know the authenticated User.id, while the commercial boundary is
 * attached to Agent. Accounts without an Agent row retain the pre-existing
 * authorization behavior; agent-only surfaces still enforce that invariant in
 * getCurrentAgent().
 */
export async function requireFounderAccessForUser(
  userId: string,
  now = new Date(),
): Promise<FounderAccessResolution> {
  const agent = await prisma.agent.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!agent) return legacyAccess()
  return requireFounderAccessForAgent(agent.id, now)
}
