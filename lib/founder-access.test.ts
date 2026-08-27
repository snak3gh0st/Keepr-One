import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findAgent: vi.fn(),
  findFounderEnrollment: vi.fn(),
  findAcceptedAgencyInvitation: vi.fn(),
  findPlatformSubscriptions: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: {
      findUnique: mocks.findAgent,
    },
    founderEnrollment: {
      findUnique: mocks.findFounderEnrollment,
    },
    agencyInvitation: {
      findFirst: mocks.findAcceptedAgencyInvitation,
    },
    platformSubscription: {
      findMany: mocks.findPlatformSubscriptions,
    },
  },
}))

import {
  calculateFounderTrialEnd,
  FOUNDER_TRIAL_DURATION_MS,
  FOUNDER_TRIAL_DURATION_SECONDS,
  FounderAccessRequiredError,
  requireFounderAccessForAgent,
  requireFounderAccessForUser,
  resolveFounderAccessForAgent,
  type FounderAccessSubscription,
} from './founder-access'

const trialStartedAt = new Date('2026-08-01T12:00:00.000Z')
const trialEndsAt = new Date(
  trialStartedAt.getTime() + FOUNDER_TRIAL_DURATION_MS,
)
const middleOfTrial = new Date('2026-08-15T12:00:00.000Z')

function founder(
  overrides: Partial<{
    id: string
    agentId: string
    agencyId: string | null
    accountType: 'AGENT' | 'AGENCY'
    cohort: string
    trialStartedAt: Date
    trialEndsAt: Date
  }> = {},
) {
  return {
    id: 'founder-1',
    agentId: 'agent-1',
    agencyId: null,
    accountType: 'AGENT' as const,
    cohort: 'FOUNDERS_2026',
    trialStartedAt,
    trialEndsAt,
    ...overrides,
  }
}

function subscription(
  overrides: Partial<FounderAccessSubscription> = {},
): FounderAccessSubscription {
  return {
    id: 'subscription-1',
    plan: 'AGENT_INDIVIDUAL',
    status: 'TRIALING',
    unitAmountCents: 5_990,
    currency: 'USD',
    currentPeriodStart: trialStartedAt,
    currentPeriodEnd: trialEndsAt,
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

function acceptedInvitation(
  overrides: Partial<{
    id: string
    agencyId: string
    acceptedAgentId: string | null
    acceptedPlan: 'AGENT_INDIVIDUAL' | 'AGENCY' | 'AGENT_AGENCY_MEMBER' | null
    agency: { name: string }
    acceptedMembership: {
      id: string
      agentId: string
      agencyId: string
      role: 'OWNER' | 'MEMBER'
      endedAt: Date | null
      agency: { parentAgencyId: string | null }
    } | null
  }> = {},
) {
  return {
    id: 'invitation-1',
    agencyId: 'parent-agency-1',
    acceptedAgentId: 'agent-1',
    acceptedPlan: 'AGENT_AGENCY_MEMBER' as const,
    agency: { name: 'Agência Aurora' },
    acceptedMembership: {
      id: 'membership-1',
      agentId: 'agent-1',
      agencyId: 'parent-agency-1',
      role: 'MEMBER' as const,
      endedAt: null,
      agency: { parentAgencyId: null },
    },
    ...overrides,
  }
}

describe('founder trial duration', () => {
  it('is exactly 2,592,000 seconds and does not mutate the start date', () => {
    const start = new Date('2026-03-07T17:30:00.000Z')
    const originalTimestamp = start.getTime()
    const end = calculateFounderTrialEnd(start)

    expect(FOUNDER_TRIAL_DURATION_SECONDS).toBe(2_592_000)
    expect(end.getTime() - start.getTime()).toBe(2_592_000_000)
    expect(start.getTime()).toBe(originalTimestamp)
    // This interval crosses the US daylight-saving transition but remains an
    // exact 720-hour commercial period.
    expect(end.toISOString()).toBe('2026-04-06T17:30:00.000Z')
  })

  it('rejects an invalid start date', () => {
    expect(() => calculateFounderTrialEnd(new Date(Number.NaN))).toThrow(
      new RangeError('trialStartedAt must be a valid Date'),
    )
  })
})

describe('founder access resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(middleOfTrial)
    vi.clearAllMocks()
    mocks.findFounderEnrollment.mockResolvedValue(founder())
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(null)
    mocks.findPlatformSubscriptions.mockResolvedValue([subscription()])
    mocks.findAgent.mockResolvedValue({ id: 'agent-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('grandfathers legacy agents and does not query subscriptions', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(null)

    await expect(resolveFounderAccessForAgent('agent-legacy')).resolves.toEqual({
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
    })
    expect(mocks.findPlatformSubscriptions).not.toHaveBeenCalled()
  })

  it('requires the exact invited-member subscription after an invitation is accepted', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(null)
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation())
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({
        plan: 'AGENT_AGENCY_MEMBER',
        status: 'ACTIVE',
        unitAmountCents: 4_990,
      }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'PAID',
      hasAccess: true,
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENT_AGENCY_MEMBER',
      founderEnrollmentId: null,
      agencyInvitationId: 'invitation-1',
      invitingAgencyName: 'Agência Aurora',
      accountType: 'AGENT',
      subscription: {
        plan: 'AGENT_AGENCY_MEMBER',
        unitAmountCents: 4_990,
      },
    })
    expect(mocks.findPlatformSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agencyMembershipId: 'membership-1',
          plan: 'AGENT_AGENCY_MEMBER',
        },
      }),
    )
  })

  it('requires the child-agency subscription for an invitee who selected Agency', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(null)
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation({
      acceptedPlan: 'AGENCY',
      acceptedMembership: {
        id: 'child-owner-membership',
        agentId: 'agent-1',
        agencyId: 'child-agency-1',
        role: 'OWNER',
        endedAt: null,
        agency: { parentAgencyId: 'parent-agency-1' },
      },
    }))
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({
        plan: 'AGENCY',
        status: 'TRIALING',
        unitAmountCents: 9_990,
      }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'TRIAL',
      hasAccess: true,
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENCY',
      accountType: 'AGENCY',
    })
    expect(mocks.findPlatformSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyId: 'child-agency-1', plan: 'AGENCY' },
      }),
    )
  })

  it('makes an accepted invitation authoritative over a Founder enrollment', async () => {
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation())
    mocks.findPlatformSubscriptions.mockResolvedValue([])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENT_AGENCY_MEMBER',
    })
    expect(mocks.findPlatformSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agencyMembershipId: 'membership-1' }),
      }),
    )
  })

  it.each([
    {
      label: 'starts in the future',
      currentPeriodStart: new Date(middleOfTrial.getTime() + 1),
      currentPeriodEnd: trialEndsAt,
    },
    {
      label: 'ends now',
      currentPeriodStart: trialStartedAt,
      currentPeriodEnd: middleOfTrial,
    },
    {
      label: 'has no period end',
      currentPeriodStart: trialStartedAt,
      currentPeriodEnd: null,
    },
  ])('denies an invited plan when its subscription $label', async (period) => {
    mocks.findFounderEnrollment.mockResolvedValue(null)
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation())
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({
        plan: 'AGENT_AGENCY_MEMBER',
        status: 'ACTIVE',
        currentPeriodStart: period.currentPeriodStart,
        currentPeriodEnd: period.currentPeriodEnd,
      }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
      source: 'AGENCY_INVITATION',
    })
  })

  it.each(['PAST_DUE', 'CANCELED', 'EXPIRED'] as const)(
    'denies an invited %s subscription even while its dates are current',
    async (status) => {
      mocks.findFounderEnrollment.mockResolvedValue(null)
      mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation())
      mocks.findPlatformSubscriptions.mockResolvedValue([
        subscription({ plan: 'AGENT_AGENCY_MEMBER', status }),
      ])

      await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
        state: 'EXPIRED',
        hasAccess: false,
        source: 'AGENCY_INVITATION',
      })
    },
  )

  it('fails closed when the accepted membership no longer matches the invitation', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(null)
    mocks.findAcceptedAgencyInvitation.mockResolvedValue(acceptedInvitation({
      acceptedMembership: {
        id: 'membership-1',
        agentId: 'another-agent',
        agencyId: 'parent-agency-1',
        role: 'MEMBER',
        endedAt: null,
        agency: { parentAgencyId: null },
      },
    }))

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
      source: 'AGENCY_INVITATION',
      subscription: null,
    })
    expect(mocks.findPlatformSubscriptions).not.toHaveBeenCalled()
  })

  it('resolves a current individual founder trial by agent subject', async () => {
    const access = await resolveFounderAccessForAgent('agent-1')

    expect(access).toMatchObject({
      state: 'TRIAL',
      hasAccess: true,
      founderEnrollmentId: 'founder-1',
      accountType: 'AGENT',
      cohort: 'FOUNDERS_2026',
      subscription: { id: 'subscription-1', status: 'TRIALING' },
    })
    expect(mocks.findPlatformSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: 'agent-1', plan: 'AGENT_INDIVIDUAL' },
      }),
    )
  })

  it('resolves an agency founder against the agency subscription subject', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(founder({
      accountType: 'AGENCY',
      agencyId: 'agency-1',
    }))
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({ plan: 'AGENCY', unitAmountCents: 9_990 }),
    ])

    const access = await resolveFounderAccessForAgent('agent-1')

    expect(access).toMatchObject({
      state: 'TRIAL',
      accountType: 'AGENCY',
      subscription: { plan: 'AGENCY' },
    })
    expect(mocks.findPlatformSubscriptions).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyId: 'agency-1', plan: 'AGENCY' },
      }),
    )
  })

  it('includes the start instant and excludes the exact trial end instant', async () => {
    vi.setSystemTime(trialStartedAt)
    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'TRIAL',
      hasAccess: true,
    })

    vi.setSystemTime(new Date(trialEndsAt.getTime() - 1))
    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'TRIAL',
      hasAccess: true,
    })

    vi.setSystemTime(trialEndsAt)
    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
    })
  })

  it.each([
    { currentPeriodStart: null, currentPeriodEnd: trialEndsAt },
    { currentPeriodStart: trialStartedAt, currentPeriodEnd: null },
  ])('fails closed when a trial subscription period is incomplete: %o', async (period) => {
    mocks.findPlatformSubscriptions.mockResolvedValue([subscription(period)])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
    })
  })

  it('also enforces the subscription end when it is earlier than the cohort end', async () => {
    const subscriptionEnd = new Date('2026-08-10T12:00:00.000Z')
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({ currentPeriodEnd: subscriptionEnd }),
    ])
    vi.setSystemTime(subscriptionEnd)

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
    })
  })

  it('fails closed when historical founder data does not contain an exact 30-day trial', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(founder({
      trialEndsAt: new Date(trialEndsAt.getTime() + 1),
    }))

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
    })
  })

  it('treats a dated ACTIVE subscription as paid even after the trial has ended', async () => {
    const paidStart = new Date('2026-08-31T12:00:00.000Z')
    const paidEnd = new Date('2026-09-30T12:00:00.000Z')
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'))
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({
        status: 'ACTIVE',
        currentPeriodStart: paidStart,
        currentPeriodEnd: paidEnd,
      }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'PAID',
      hasAccess: true,
      subscription: { status: 'ACTIVE' },
    })
  })

  it.each(['PAST_DUE', 'CANCELED', 'EXPIRED'] as const)(
    'does not entitle a %s subscription',
    async (status) => {
      mocks.findPlatformSubscriptions.mockResolvedValue([
        subscription({ status }),
      ])

      await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
        state: 'EXPIRED',
        hasAccess: false,
        subscription: { status },
      })
    },
  )

  it('requires a complete period for an ACTIVE subscription', async () => {
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({ status: 'ACTIVE', currentPeriodEnd: null }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
    })
  })

  it('prefers a current paid row over newer non-entitling history', async () => {
    mocks.findPlatformSubscriptions.mockResolvedValue([
      subscription({ id: 'newer-canceled', status: 'CANCELED' }),
      subscription({ id: 'paid-current', status: 'ACTIVE' }),
    ])

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'PAID',
      subscription: { id: 'paid-current' },
    })
  })

  it('fails closed for a malformed account-type subject without querying billing', async () => {
    mocks.findFounderEnrollment.mockResolvedValue(founder({
      accountType: 'AGENCY',
      agencyId: null,
    }))

    await expect(resolveFounderAccessForAgent('agent-1')).resolves.toMatchObject({
      state: 'EXPIRED',
      hasAccess: false,
      subscription: null,
    })
    expect(mocks.findPlatformSubscriptions).not.toHaveBeenCalled()
  })

  it('throws a typed error only when access is required', async () => {
    mocks.findPlatformSubscriptions.mockResolvedValue([])

    await expect(requireFounderAccessForAgent('agent-1')).rejects.toMatchObject({
      name: 'FounderAccessRequiredError',
      code: 'FOUNDER_ACCESS_REQUIRED',
      access: {
        state: 'EXPIRED',
        hasAccess: false,
      },
    })

    try {
      await requireFounderAccessForAgent('agent-1')
      throw new Error('Expected founder access enforcement to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(FounderAccessRequiredError)
    }

    mocks.findFounderEnrollment.mockResolvedValue(null)
    await expect(requireFounderAccessForAgent('agent-legacy')).resolves.toMatchObject({
      state: 'LEGACY',
      hasAccess: true,
    })
  })

  it('bridges the authenticated User.id to the Founder agent boundary', async () => {
    await expect(requireFounderAccessForUser('user-1')).resolves.toMatchObject({
      state: 'TRIAL',
      hasAccess: true,
    })
    expect(mocks.findAgent).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { id: true },
    })
    expect(mocks.findFounderEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1' },
    }))
  })

  it('leaves an authenticated role without an Agent row on the legacy path', async () => {
    mocks.findAgent.mockResolvedValue(null)

    await expect(requireFounderAccessForUser('admin-without-agent')).resolves.toMatchObject({
      state: 'LEGACY',
      hasAccess: true,
    })
    expect(mocks.findFounderEnrollment).not.toHaveBeenCalled()
  })

  it('rejects an invalid controlled clock before querying persistence', async () => {
    await expect(
      resolveFounderAccessForAgent('agent-1', new Date(Number.NaN)),
    ).rejects.toThrow(new RangeError('now must be a valid Date'))
    expect(mocks.findFounderEnrollment).not.toHaveBeenCalled()
  })
})
