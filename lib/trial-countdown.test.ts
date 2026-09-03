import { describe, expect, it } from 'vitest'
import type { FounderAccessResolution } from '@/lib/founder-access'
import { buildTrialCountdownView } from './trial-countdown'

const now = new Date('2026-08-26T12:00:00.000Z')
const founderEnd = new Date('2026-09-25T12:00:00.000Z')

function access(
  overrides: Partial<FounderAccessResolution> = {},
): FounderAccessResolution {
  return {
    state: 'TRIAL',
    hasAccess: true,
    source: 'FOUNDER',
    requiredPlan: 'AGENT_INDIVIDUAL',
    founderEnrollmentId: 'founder-1',
    agencyInvitationId: null,
    adminProvisionedAccessId: null,
    paymentRequiredAt: null,
    paymentReason: null,
    invitingAgencyName: null,
    accountType: 'AGENT',
    cohort: 'FOUNDERS_2026',
    trialStartedAt: now,
    trialEndsAt: founderEnd,
    subscription: {
      id: 'subscription-1',
      plan: 'AGENT_INDIVIDUAL',
      status: 'TRIALING',
      unitAmountCents: 5_990,
      currency: 'USD',
      currentPeriodStart: now,
      currentPeriodEnd: founderEnd,
      cancelAtPeriodEnd: false,
    },
    ...overrides,
  }
}

describe('buildTrialCountdownView', () => {
  it('serializes the exact current Founder trial boundary', () => {
    expect(buildTrialCountdownView(access(), now)).toEqual({
      source: 'FOUNDER',
      plan: 'AGENT_INDIVIDUAL',
      endsAt: founderEnd.toISOString(),
      initialRemainingSeconds: 30 * 24 * 60 * 60,
    })
  })

  it('uses the earlier subscription boundary when it shortens a Founder trial', () => {
    const subscriptionEnd = new Date('2026-09-01T12:00:00.000Z')

    expect(buildTrialCountdownView(access({
      subscription: {
        ...access().subscription!,
        currentPeriodEnd: subscriptionEnd,
      },
    }), now)).toMatchObject({
      endsAt: subscriptionEnd.toISOString(),
      initialRemainingSeconds: 6 * 24 * 60 * 60,
    })
  })

  it('uses the subscription period for a trial created from an agency invitation', () => {
    expect(buildTrialCountdownView(access({
      source: 'AGENCY_INVITATION',
      requiredPlan: 'AGENT_AGENCY_MEMBER',
      founderEnrollmentId: null,
      agencyInvitationId: 'invite-1',
      invitingAgencyName: 'Agência Aurora',
      accountType: 'AGENT',
      cohort: null,
      trialStartedAt: null,
      trialEndsAt: null,
      subscription: {
        ...access().subscription!,
        plan: 'AGENT_AGENCY_MEMBER',
      },
    }), now)).toEqual({
      source: 'AGENCY_INVITATION',
      plan: 'AGENT_AGENCY_MEMBER',
      endsAt: founderEnd.toISOString(),
      initialRemainingSeconds: 30 * 24 * 60 * 60,
    })
  })

  it('shows the custom period for an administratively provisioned trial', () => {
    const customEnd = new Date('2026-09-09T12:00:00.000Z')

    expect(buildTrialCountdownView(access({
      source: 'ADMIN_PROVISIONED',
      founderEnrollmentId: null,
      adminProvisionedAccessId: 'managed-access-1',
      cohort: null,
      trialEndsAt: customEnd,
      subscription: {
        ...access().subscription!,
        currentPeriodEnd: customEnd,
      },
    }), now)).toEqual({
      source: 'ADMIN_PROVISIONED',
      plan: 'AGENT_INDIVIDUAL',
      endsAt: customEnd.toISOString(),
      initialRemainingSeconds: 14 * 24 * 60 * 60,
    })
  })

  it.each(['LEGACY', 'PAID', 'EXPIRED'] as const)(
    'does not display a countdown for %s access',
    (state) => {
      expect(buildTrialCountdownView(access({ state }), now)).toBeNull()
    },
  )

  it('fails closed when the current trial has no dated subscription end', () => {
    expect(buildTrialCountdownView(access({
      subscription: {
        ...access().subscription!,
        currentPeriodEnd: null,
      },
    }), now)).toBeNull()
  })

  it('excludes the exact end instant and rounds a positive fraction up', () => {
    expect(buildTrialCountdownView(access(), founderEnd)).toBeNull()

    expect(buildTrialCountdownView(
      access(),
      new Date(founderEnd.getTime() - 1),
    )).toMatchObject({ initialRemainingSeconds: 1 })
  })

  it('rejects an invalid controlled clock', () => {
    expect(() => buildTrialCountdownView(
      access(),
      new Date(Number.NaN),
    )).toThrow(new RangeError('now must be a valid Date'))
  })
})
