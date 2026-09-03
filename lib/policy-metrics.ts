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
  if (premium == null || typeof premium === 'boolean') return null
  const text = String(premium).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const amount = Number(text)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export type NationalLifePortfolioMetricRow = {
  clientId: string | null
  status: string
  sourceStatus: string | null
  premium: unknown
  sourceUpdatedAt: Date | null
}

export type NationalLifePortfolioMetrics = {
  hasData: boolean
  activeClients: number
  clientCoverageComplete: boolean
  activePolicies: number
  activeAap: number
  averageAapPerClient: number | null
  premiumKnownPolicies: number
  premiumMissingPolicies: number
  premiumCoverageComplete: boolean
  pendingLapsePolicies: number
  lapsedPolicies: number
  cancelledPolicies: number
  attentionPolicies: number
  atRiskAap: number
  atRiskPremiumKnownPolicies: number
  atRiskPremiumMissingPolicies: number
  atRiskPremiumCoverageComplete: boolean
  lostAap: number
  lastUpdatedAt: Date | null
}

function isPendingLapse(sourceStatus: string | null): boolean {
  return (sourceStatus ?? '').trim().toLowerCase() === 'pending lapse'
}

export function buildNationalLifePortfolioMetrics(
  rows: readonly NationalLifePortfolioMetricRow[],
): NationalLifePortfolioMetrics {
  const activeRows = rows.filter((row) => row.status === 'INFORCE')
  const pendingLapseRows = activeRows.filter((row) => isPendingLapse(row.sourceStatus))
  const lapsedRows = rows.filter((row) => row.status === 'LAPSED')
  const cancelledRows = rows.filter((row) => row.status === 'CANCELLED')
  const activeAaps = activeRows.map((row) => auditedNationalLifeAap(row.premium))
  const pendingLapseAaps = pendingLapseRows.map((row) => auditedNationalLifeAap(row.premium))
  const activeAap = activeAaps.reduce<number>(
    (total, premium) => total + Math.round((premium ?? 0) * 100),
    0,
  ) / 100
  const premiumKnownPolicies = activeAaps.filter((premium) => premium !== null).length
  const atRiskPremiumKnownPolicies = pendingLapseAaps.filter((premium) => premium !== null).length
  const activeClients = new Set(activeRows.map((row) => row.clientId).filter(Boolean)).size
  const clientCoverageComplete = activeRows.every((row) => row.clientId !== null)
  const premiumCoverageComplete = activeRows.length > 0 && premiumKnownPolicies === activeRows.length
  const lastUpdatedAt = rows.reduce<Date | null>(
    (latest, row) => row.sourceUpdatedAt && (!latest || row.sourceUpdatedAt > latest)
      ? row.sourceUpdatedAt
      : latest,
    null,
  )

  return {
    hasData: rows.length > 0,
    activeClients,
    clientCoverageComplete,
    activePolicies: activeRows.length,
    activeAap,
    averageAapPerClient:
      premiumCoverageComplete && clientCoverageComplete && activeClients > 0 ? activeAap / activeClients : null,
    premiumKnownPolicies,
    premiumMissingPolicies: activeRows.length - premiumKnownPolicies,
    premiumCoverageComplete,
    pendingLapsePolicies: pendingLapseRows.length,
    lapsedPolicies: lapsedRows.length,
    cancelledPolicies: cancelledRows.length,
    attentionPolicies: pendingLapseRows.length + lapsedRows.length + cancelledRows.length,
    atRiskAap: pendingLapseAaps.reduce<number>(
      (total, premium) => total + Math.round((premium ?? 0) * 100),
      0,
    ) / 100,
    atRiskPremiumKnownPolicies,
    atRiskPremiumMissingPolicies: pendingLapseRows.length - atRiskPremiumKnownPolicies,
    atRiskPremiumCoverageComplete:
      pendingLapseRows.length > 0 && atRiskPremiumKnownPolicies === pendingLapseRows.length,
    lostAap: [...lapsedRows, ...cancelledRows].reduce(
      (total, row) => total + Math.round((auditedNationalLifeAap(row.premium) ?? 0) * 100),
      0,
    ) / 100,
    lastUpdatedAt,
  }
}
