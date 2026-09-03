import { decimalToNumber } from './decimal'

/**
 * Policy.premium is modal when premiumMode is known. National Life's in-force
 * import stores AAP with no mode, so a missing mode is already annual rather
 * than an invitation to multiply an unknown value.
 */
export function auditedAnnualizedPolicyPremium(premium: unknown, premiumMode: string | null): number | null {
  const amount = decimalToNumber(premium)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const mode = (premiumMode ?? 'ANNUAL').replace(/[^A-Z]/gi, '').toUpperCase()
  if (mode === 'MONTHLY' || mode === 'MONTH') return amount * 12
  if (mode === 'QUARTERLY' || mode === 'QUARTER') return amount * 4
  if (mode === 'SEMIANNUAL' || mode === 'SEMIANNUALLY') return amount * 2
  if (mode === 'ANNUAL' || mode === 'ANNUALLY' || mode === 'YEARLY') return amount
  return null
}

export function annualizedPolicyPremium(premium: unknown, premiumMode: string | null): number {
  return auditedAnnualizedPolicyPremium(premium, premiumMode) ?? 0
}

/**
 * The National Life in-force mapper persists `AnticipatedAnnualPremium` in
 * Policy.premium. It is already annual, regardless of a stale `premiumMode`
 * left by an older/manual row. Multiplying that AAP a second time inflated the
 * audited production dashboard for policies that still said Monthly or
 * Quarterly.
 */
export function auditedNationalLifeAap(premium: unknown): number | null {
  const amount = decimalToNumber(premium)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}
