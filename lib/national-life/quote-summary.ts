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
type QuoteFacts = {
  issueAge: number | null
  issueState: string | null
  gender: string | null
  rateClass: string | null
  strategy: string | null
  annualPremium: number | null
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

export function summarizeQuotePayload(payload: unknown): QuoteFacts {
  const root = record(payload)
  const request = record(root.request)
  const response = record(root.response)

  return {
    issueAge: number(request.IssueAge),
    issueState: text(request.IssueState),
    gender: text(request.Gender),
    rateClass: text(request.RateClass),
    strategy: text(request.Strategy),
    annualPremium: number(response.annualPremium),
  }
}
