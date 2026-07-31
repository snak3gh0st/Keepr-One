import { describe, expect, it } from 'vitest'
import { carrierLabel } from './rapid-solve-labels'

describe('carrierLabel', () => {
  it('expands the solve types the carrier actually sends', () => {
    expect(carrierLabel('solveType', 'Min_DB_Max_Cash_Value')).toBe(
      'Minimum death benefit, maximum cash value',
    )
    expect(carrierLabel('solveType', 'Based_on_Target_Premium')).toBe(
      'Premium-based, death benefit focus',
    )
    expect(carrierLabel('solveType', 'Specify_Amount')).toBe('Specified face amount')
  })

  it('expands rate class, death benefit option and strategy', () => {
    expect(carrierLabel('rateClass', 'Standard_NT')).toBe('Standard Non-Tobacco')
    expect(carrierLabel('deathBenefitOption', 'A_Level')).toBe('Option A — Level')
    expect(carrierLabel('strategy', 'SP500PointToPointCapFocus')).toBe(
      'S&P 500 Point-to-Point, Cap Focus',
    )
  })

  // A carrier that adds a solve type must not be mistranslated into a
  // plausible-sounding guess. The agent has to be able to repeat the code to
  // whoever can read it.
  it('gives back the raw code when it does not know one', () => {
    expect(carrierLabel('solveType', 'Some_New_Solve')).toBe('Some_New_Solve')
  })

  it('has nothing to say about a missing code', () => {
    expect(carrierLabel('rateClass', null)).toBeNull()
    expect(carrierLabel('rateClass', undefined)).toBeNull()
    expect(carrierLabel('rateClass', '   ')).toBeNull()
  })
})
