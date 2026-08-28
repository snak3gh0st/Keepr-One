import type { Prisma } from '@prisma/client'

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE'] as const

type InvitationAuthorityClient = Pick<
  Prisma.TransactionClient,
  'agencyMembership'
>

function activeSubscriptionPeriodWhere(
  now: Date,
): Prisma.PlatformSubscriptionWhereInput {
  return {
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

/**
 * Revalidates that an invitation issuer still belongs to the invitation's
 * agency and still pays for the exact commercial role that grants invites.
 * Team visibility is intentionally unrelated to this narrow authority.
 */
export async function findActiveAgencyInvitationAuthority(
  client: InvitationAuthorityClient,
  input: {
    agencyId: string
    agentId: string
    now: Date
  },
) {
  const activePeriod = activeSubscriptionPeriodWhere(input.now)

  return client.agencyMembership.findFirst({
    where: {
      agencyId: input.agencyId,
      agentId: input.agentId,
      endedAt: null,
      agent: { status: 'ACTIVE' },
      OR: [
        {
          role: 'OWNER',
          agency: {
            subscriptions: {
              some: {
                plan: 'AGENCY',
                ...activePeriod,
              },
            },
          },
        },
        {
          role: 'MEMBER',
          subscriptions: {
            some: {
              plan: 'AGENT_AGENCY_MEMBER',
              ...activePeriod,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      role: true,
    },
  })
}
