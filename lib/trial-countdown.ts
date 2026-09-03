import type { FounderAccessResolution } from '@/lib/founder-access'
import type { PlatformPlanName } from '@/lib/plans'

export type TrialCountdownSource = Extract<
  FounderAccessResolution['source'],
  'FOUNDER' | 'AGENCY_INVITATION' | 'ADMIN_PROVISIONED'
>

export type TrialCountdownView = {
  source: TrialCountdownSource
  plan: PlatformPlanName
  endsAt: string
  initialRemainingSeconds: number
}

function validTimestamp(value: Date | null): number | null {
  if (!value) return null
  const timestamp = value.getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

/**
 * Converts the commercial access resolution into a serializable UI contract.
 * Authorization continues to live in founder-access; the countdown can only
 * display a trial that the server has already confirmed as current.
 */
export function buildTrialCountdownView(
  access: FounderAccessResolution,
  now = new Date(),
): TrialCountdownView | null {
  const nowTimestamp = now.getTime()
  if (!Number.isFinite(nowTimestamp)) {
    throw new RangeError('now must be a valid Date')
  }

  if (
    access.state !== 'TRIAL'
    || (
      access.source !== 'FOUNDER'
      && access.source !== 'AGENCY_INVITATION'
      && access.source !== 'ADMIN_PROVISIONED'
    )
    || !access.requiredPlan
  ) {
    return null
  }

  const subscriptionEnd = validTimestamp(
    access.subscription?.currentPeriodEnd ?? null,
  )
  if (subscriptionEnd === null) return null

  const founderEnd = access.source === 'FOUNDER'
    ? validTimestamp(access.trialEndsAt)
    : null
  if (access.source === 'FOUNDER' && founderEnd === null) return null

  // Access ends at the earliest authoritative boundary. Registration creates
  // matching dates, but using the minimum keeps the UI honest if billing is
  // shortened or corrected later.
  const endsAtTimestamp = founderEnd === null
    ? subscriptionEnd
    : Math.min(founderEnd, subscriptionEnd)
  const remainingMilliseconds = endsAtTimestamp - nowTimestamp
  if (remainingMilliseconds <= 0) return null

  return {
    source: access.source,
    plan: access.requiredPlan,
    endsAt: new Date(endsAtTimestamp).toISOString(),
    initialRemainingSeconds: Math.ceil(remainingMilliseconds / 1_000),
  }
}
