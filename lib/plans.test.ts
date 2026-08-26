import { describe, expect, it } from 'vitest'
import {
  PLATFORM_PLAN_PRICES_CENTS,
  formatPlanPrice,
  formatPlatformPlanPrice,
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

  it('formats cents without floating-point price drift', () => {
    expect(formatPlanPrice(4_990, 'en-US')).toBe('$49.90')
    expect(formatPlatformPlanPrice('AGENT_INDIVIDUAL', 'en-US')).toBe('$59.90')
  })

  it('refuses fractional or negative cents', () => {
    expect(() => formatPlanPrice(-1)).toThrow(RangeError)
    expect(() => formatPlanPrice(49.9)).toThrow(RangeError)
  })
})
