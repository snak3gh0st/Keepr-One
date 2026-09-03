import { describe, expect, it } from 'vitest'
import {
  annualizedPolicyPremium,
  auditedAnnualizedPolicyPremium,
  auditedNationalLifeAap,
} from './policy-metrics'

describe('annualizedPolicyPremium', () => {
  it.each([
    [250, 'MONTHLY', 3_000],
    [750, 'Quarterly', 3_000],
    [1_500, 'Semi-Annual', 3_000],
    [3_000, 'ANNUAL', 3_000],
    [3_000, null, 3_000],
  ])('normalizes a recorded policy premium without mixing payment modes', (premium, mode, expected) => {
    expect(annualizedPolicyPremium(premium, mode)).toBe(expected)
  })

  it('excludes missing and non-positive values instead of presenting them as production', () => {
    expect(annualizedPolicyPremium(null, 'MONTHLY')).toBe(0)
    expect(annualizedPolicyPremium(0, 'MONTHLY')).toBe(0)
  })

  it('blocks an unknown payment mode from an audited total', () => {
    expect(auditedAnnualizedPolicyPremium(250, 'Every other week')).toBeNull()
    expect(annualizedPolicyPremium(250, 'Every other week')).toBe(0)
  })
})

describe('auditedNationalLifeAap', () => {
  it('keeps the carrier AAP annual instead of multiplying a stale modal frequency', () => {
    expect(auditedNationalLifeAap(1_200)).toBe(1_200)
  })

  it('fails closed for a missing or non-positive AAP', () => {
    expect(auditedNationalLifeAap(null)).toBeNull()
    expect(auditedNationalLifeAap(0)).toBeNull()
  })
})
