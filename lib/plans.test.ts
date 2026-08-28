import { describe, expect, it } from 'vitest'
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  INVITED_AGENCY_MONTHLY_PRICE_CENTS,
  PLATFORM_PLAN_PRICES_CENTS,
  formatPlanPrice,
  formatPlatformPlanPrice,
  getAgencyInvitationPriceCents,
  getPlatformPlanPriceCents,
} from './plans'

describe('platform plan prices', () => {
  it('keeps the invited-agent discount as one shared business rule', () => {
    expect(PLATFORM_PLAN_PRICES_CENTS).toEqual({
      AGENT_INDIVIDUAL: 5_990,
      AGENCY: 9_990,
      AGENT_AGENCY_MEMBER: 4_990,
    })
    expect(getPlatformPlanPriceCents('AGENT_AGENCY_MEMBER')).toBe(4_990)
  })

  it('applies the same ten-dollar invitation discount to agents and agencies', () => {
    expect(AGENCY_INVITATION_DISCOUNT_CENTS).toBe(1_000)
    expect(getAgencyInvitationPriceCents('AGENT')).toBe(4_990)
    expect(getAgencyInvitationPriceCents('AGENCY')).toBe(8_990)
    expect(INVITED_AGENCY_MONTHLY_PRICE_CENTS).toBe(8_990)
  })

  it('formats cents without floating-point price drift', () => {
    expect(formatPlanPrice(4_990, 'en-US')).toBe('$49.90')
    expect(formatPlatformPlanPrice('AGENT_INDIVIDUAL', 'en-US')).toBe('$59.90')
  })

  it('refuses fractional or negative cents', () => {
    expect(() => formatPlanPrice(-1)).toThrow(RangeError)
    expect(() => formatPlanPrice(49.9)).toThrow(RangeError)
  })
})
