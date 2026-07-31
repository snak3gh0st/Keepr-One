import { describe, expect, it } from 'vitest'
import { carrierLabel, LABELS, type CarrierLabelField } from './rapid-solve-labels'

// One row per code the carrier bundle defines in the LABELS map inside
// rapid-solve-labels.ts. Spelled out by hand rather than generated from the
// map itself: importing LABELS and iterating its own entries would make this
// test pass no matter what the map says, so a label silently deleted from it
// would go untested rather than fail. With the pairs written out here, a
// deleted or renamed entry falls back to carrierLabel's raw-code behaviour,
// which no longer matches the expected label, and the row fails loudly.
const CASES: Array<[CarrierLabelField, string, string]> = [
  ['solveType', 'Specify_Amount', 'Specified face amount'],
  ['solveType', 'Based_on_Target_Premium', 'Premium-based, death benefit focus'],
  ['solveType', 'Min_DB_Max_Cash_Value', 'Minimum death benefit, maximum cash value'],
  ['rateClass', 'Standard_NT', 'Standard Non-Tobacco'],
  ['rateClass', 'Standard_Tobacco', 'Standard Tobacco'],
  ['deathBenefitOption', 'A_Level', 'Option A — Level'],
  ['deathBenefitOption', 'B_Increasing', 'Option B — Increasing'],
  ['strategy', 'SP500PointToPointCapFocus', 'S&P 500 Point-to-Point, Cap Focus'],
  ['strategy', 'SP500PointToPointParFocus', 'S&P 500 Point-to-Point, Par Focus'],
  ['strategy', 'SP500PointToPointOnePercentFloor', 'S&P 500 Point-to-Point, 1% Floor'],
]

describe('carrierLabel', () => {
  it.each(CASES)('expands %s code %s to %s', (field, code, expected) => {
    expect(carrierLabel(field, code)).toBe(expected)
  })

  // Catches the direction the per-entry table above can't: a code *added* to
  // LABELS without a matching row here would otherwise go untested forever.
  it('has exactly as many table rows as the map has entries', () => {
    const total = Object.values(LABELS).reduce(
      (sum, group) => sum + Object.keys(group).length,
      0,
    )
    expect(CASES).toHaveLength(total)
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
