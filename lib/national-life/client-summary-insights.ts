import type { ClientSummary } from './client-summary'

export type ClientPolicyCheckpoint = {
  policyYear: number
  age: number
  premiumOutlay: number | null
  totalPaid: number | null
  cashSurrenderValue: number
  netDeathBenefit: number
  surrenderDifference: number | null
}

export type ClientPolicyInsights = {
  dataIsAnnual: boolean
  contributionBasis: 'ANNUAL_LEDGER' | 'CONFIRMED_LEVEL_PREMIUM' | 'UNAVAILABLE'
  breakEven: ClientPolicyCheckpoint | null
  breakEvenWindow: { afterYear: number; byYear: number } | null
  checkpoints: ClientPolicyCheckpoint[]
}

/// Turns the carrier ledger into decision support without asking a model to do
/// arithmetic. Every result keeps the exact source year and values so the PDF
/// can explain the finding and still be reconciled against National Life.
export function analyzeClientPolicy(summary: ClientSummary): ClientPolicyInsights | null {
  if (summary.kind !== 'PROJECTED') return null
  const rows = [...summary.coverage].sort((left, right) => left.policyYear - right.policyYear)
  if (rows.length === 0) return null

  const dataIsAnnual = rows[0]!.policyYear === 1 && rows.every((row, index) =>
    row.policyYear === index + 1 && row.premiumOutlay !== null)
  const hasConfirmedLevelPremium = rows[0]!.policyYear === 1 && summary.annualPremium > 0 &&
    rows.every((row) => row.premiumOutlay === summary.annualPremium)
  const contributionBasis = dataIsAnnual
    ? 'ANNUAL_LEDGER'
    : hasConfirmedLevelPremium ? 'CONFIRMED_LEVEL_PREMIUM' : 'UNAVAILABLE'
  let runningPaid = 0
  const analyzed = rows
    .map((row): ClientPolicyCheckpoint | null => {
      if (dataIsAnnual) runningPaid += row.premiumOutlay!
      if (row.cashSurrenderValue === null) return null
      const totalPaid = dataIsAnnual
        ? runningPaid
        : hasConfirmedLevelPremium ? summary.annualPremium * row.policyYear : null
      return {
        policyYear: row.policyYear,
        age: row.age,
        premiumOutlay: row.premiumOutlay,
        totalPaid,
        cashSurrenderValue: row.cashSurrenderValue,
        netDeathBenefit: row.netDeathBenefit,
        surrenderDifference: totalPaid === null ? null : row.cashSurrenderValue - totalPaid,
      }
    })
    .filter((row): row is ClientPolicyCheckpoint => row !== null)

  const breakEven = analyzed.find((row) =>
    row.totalPaid !== null && row.cashSurrenderValue >= row.totalPaid) ?? null
  const breakEvenIndex = breakEven === null ? -1 : analyzed.indexOf(breakEven)
  const previous = breakEvenIndex > 0 ? analyzed[breakEvenIndex - 1]! : null
  const breakEvenWindow = !dataIsAnnual && breakEven !== null && previous !== null &&
    previous.surrenderDifference !== null && previous.surrenderDifference < 0
    ? { afterYear: previous.policyYear, byYear: breakEven.policyYear }
    : null
  const selectedYears = new Set([5, 10, 20, 30, breakEven?.policyYear, analyzed.at(-1)?.policyYear])
  const checkpoints = analyzed.filter((row) => selectedYears.has(row.policyYear))
  return { dataIsAnnual, contributionBasis, breakEven, breakEvenWindow, checkpoints }
}
