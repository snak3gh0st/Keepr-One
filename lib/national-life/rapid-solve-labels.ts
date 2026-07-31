/// The carrier's own vocabulary, expanded into the industry term.
///
/// English on purpose. These are regulated product terms, and translating them
/// into Portuguese is how you end up misinforming someone about a financial
/// product — "Standard Non-Tobacco" is the rate class, not a description of
/// one. The screen around them stays in Portuguese, like the rest of the app.
///
/// Codes come from `lib/national-life/rapid-solve.ts`, which reads them off the
/// carrier's own bundle.
const LABELS = {
  solveType: {
    Specify_Amount: 'Specified face amount',
    Based_on_Target_Premium: 'Premium-based, death benefit focus',
    Min_DB_Max_Cash_Value: 'Minimum death benefit, maximum cash value',
  },
  rateClass: {
    Standard_NT: 'Standard Non-Tobacco',
    Standard_Tobacco: 'Standard Tobacco',
  },
  deathBenefitOption: {
    A_Level: 'Option A — Level',
    B_Increasing: 'Option B — Increasing',
  },
  strategy: {
    SP500PointToPointCapFocus: 'S&P 500 Point-to-Point, Cap Focus',
    SP500PointToPointParFocus: 'S&P 500 Point-to-Point, Par Focus',
    SP500PointToPointOnePercentFloor: 'S&P 500 Point-to-Point, 1% Floor',
  },
} as const satisfies Record<string, Record<string, string>>

export type CarrierLabelField = keyof typeof LABELS

/// An unmapped code comes back as itself. A carrier that introduces a new value
/// must surface as that value, never as the nearest thing we happen to know.
export function carrierLabel(
  field: CarrierLabelField,
  code: string | null | undefined,
): string | null {
  if (typeof code !== 'string' || code.trim() === '') {
    return null
  }
  const known = LABELS[field] as Record<string, string | undefined>
  return known[code] ?? code
}
