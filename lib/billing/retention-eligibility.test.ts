import { describe, expect, it } from 'vitest'
import {
  resolveRetentionEligibility,
  TRIAL_CONVERSION_OFFER_WINDOW_DAYS,
} from './retention-eligibility'

const NOW = new Date('2026-09-17T12:00:00.000Z')
const DAY_MS = 86_400_000

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    plan: 'AGENT_INDIVIDUAL' as const,
    status: 'TRIALING' as const,
    unitAmountCents: 4999,
    currency: 'usd',
    currentPeriodStart: NOW,
    currentPeriodEnd: new Date(NOW.getTime() + 3 * DAY_MS),
    cancelAtPeriodEnd: false,
    ...overrides,
  }
}

describe('resolveRetentionEligibility', () => {
  it('refuses a second discount to a subscription that already received one', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'TRIAL', subscription: subscription(), trialEndsAt: new Date(NOW.getTime() + DAY_MS) },
        { alreadyGranted: true, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'ALREADY_GRANTED' })
  })

  it('never offers the discount to a legacy account', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'LEGACY', subscription: subscription(), trialEndsAt: null },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'LEGACY_ACCESS' })
  })

  it('needs a subscription to discount', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'TRIAL', subscription: null, trialEndsAt: NOW },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'NO_SUBSCRIPTION' })
  })

  it('does not discount an account that is paying full price and staying', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'PAID', subscription: subscription({ status: 'ACTIVE' }), trialEndsAt: null },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'ALREADY_PAID' })
  })

  it('treats a scheduled cancellation as the retention moment', () => {
    expect(
      resolveRetentionEligibility(
        {
          state: 'PAID',
          subscription: subscription({ status: 'ACTIVE', cancelAtPeriodEnd: true }),
          trialEndsAt: null,
        },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: true, reason: 'CANCEL_RETENTION' })
  })

  it('treats an expired trial as the retention moment', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'EXPIRED', subscription: subscription({ status: 'EXPIRED' }), trialEndsAt: NOW },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: true, reason: 'CANCEL_RETENTION' })
  })

  it('offers conversion once the trial enters its final window', () => {
    const endsAt = new Date(NOW.getTime() + (TRIAL_CONVERSION_OFFER_WINDOW_DAYS - 1) * DAY_MS)
    expect(
      resolveRetentionEligibility(
        { state: 'TRIAL', subscription: subscription(), trialEndsAt: endsAt },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: true, reason: 'TRIAL_CONVERSION' })
  })

  it('stays quiet while the trial still has plenty of time left', () => {
    const endsAt = new Date(NOW.getTime() + (TRIAL_CONVERSION_OFFER_WINDOW_DAYS + 1) * DAY_MS)
    expect(
      resolveRetentionEligibility(
        { state: 'TRIAL', subscription: subscription(), trialEndsAt: endsAt },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'OUTSIDE_TRIAL_WINDOW' })
  })

  it('falls back to the billing period end when no founder trial date exists', () => {
    expect(
      resolveRetentionEligibility(
        { state: 'TRIAL', subscription: subscription(), trialEndsAt: null },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: true, reason: 'TRIAL_CONVERSION' })
  })

  it('refuses when neither a trial end nor a period end is known', () => {
    expect(
      resolveRetentionEligibility(
        {
          state: 'TRIAL',
          subscription: subscription({ currentPeriodEnd: null }),
          trialEndsAt: null,
        },
        { alreadyGranted: false, now: NOW },
      ),
    ).toEqual({ eligible: false, refusal: 'OUTSIDE_TRIAL_WINDOW' })
  })
})
