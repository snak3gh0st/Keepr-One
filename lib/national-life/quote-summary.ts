/// Reads the stored `rawPayload` of a quote back into the few facts worth
/// showing next to the number.
///
/// The illustration row keeps face amount and monthly premium in columns, but
/// both sides of the carrier exchange were persisted whole — and the *question*
/// is what makes the answer mean anything. Two quotes for the same face amount
/// differ entirely if one is a 45-year-old non-tobacco and the other is not.
///
/// Everything is optional on purpose: rows written before a field existed, or by
/// a future carrier shape, must render as "—" rather than crash a list page.

import type { LapseYear } from './rapid-solve'

export type QuoteFacts = {
  // Sempre opcionais: linhas gravadas antes de um campo existir, ou por um
  // formato futuro do carrier, têm que renderizar "—" e não derrubar a tela.
  ok: boolean | null
  issueAge: number | null
  issueState: string | null
  gender: string | null
  rateClass: string | null
  strategy: string | null
  solveType: string | null
  deathBenefitOption: string | null
  premiumMode: string | null
  productCode: string | null
  allocation: number | null
  faceAmount: number | null
  monthlyPremium: number | null
  annualPremium: number | null
  lapseYear: LapseYear
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

// Reads back exactly what `parseRapidSolveResponse` already decided: a raw
// carrier 0 is never seen here, because only the parse site is allowed to
// interpret 0 as "never lapses" — by the time it reaches storage it is
// already 'NEVER', a number, or null. Do not add a `=== 0` check below; that
// would be re-deciding something this function has no carrier context to
// decide correctly.
function lapseYearFact(value: unknown): LapseYear {
  if (value === 'NEVER') return 'NEVER'
  return number(value)
}

export function summarizeQuotePayload(payload: unknown): QuoteFacts {
  const root = record(payload)
  const request = record(root.request)
  const response = record(root.response)

  return {
    ok: boolean(response.ok),
    issueAge: number(request.IssueAge),
    issueState: text(request.IssueState),
    gender: text(request.Gender),
    rateClass: text(request.RateClass),
    strategy: text(request.Strategy),
    solveType: text(request.SolveType),
    deathBenefitOption: text(request.DeathBenefitOption),
    premiumMode: text(request.PremiumMode),
    productCode: text(request.ProductCode),
    allocation: number(request.Allocation),
    faceAmount: number(response.faceAmount),
    monthlyPremium: number(response.monthlyPremium),
    annualPremium: number(response.annualPremium),
    lapseYear: lapseYearFact(response.lapseYear),
  }
}
