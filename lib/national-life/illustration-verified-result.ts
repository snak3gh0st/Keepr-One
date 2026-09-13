/// The single definition of "this illustration carries numbers National Life
/// actually confirmed".
///
/// These two readers used to live as private functions inside the illustration
/// detail page. They were lifted here when a second surface — the client
/// summary PDF — needed the same gate. A client-facing artifact built on a
/// slightly different reading of `rawPayload` than the agent's screen is the
/// exact failure worth designing out: the agent would be looking at one rule
/// and the insured at another.
///
/// Nothing here decides *whether* the document arrived. That is the caller's
/// `documentFetchedAt` check, because only the caller knows which columns it
/// selected.

import { isForesightQuickReview, type ForesightQuickReview } from './foresight-illustration-contract'

export type VerifiedForesightResult = {
  solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
  requestedAmount: number
  confirmedFaceAmount: number
  confirmedMonthlyPremium: number
  confirmedAnnualPremium: number
}

const CONFIRMED_AMOUNTS = [
  'confirmedFaceAmount',
  'confirmedMonthlyPremium',
  'confirmedAnnualPremium',
] as const

function positiveAmounts(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) =>
    typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) && Number(candidate[key]) > 0)
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/// The confirmed face amount and premiums, or null when this illustration has
/// no verified carrier result.
///
/// Term is read from its own `foresightTermResult`, which only counts when it
/// came from the official PDF in monthly mode — a Term row carries no solve of
/// its own, so the basis is reported as the death benefit that was asked for.
export function verifiedForesightResult(rawPayload: unknown): VerifiedForesightResult | null {
  const payload = plainObject(rawPayload)
  if (!payload) return null

  if ('foresightTermResult' in payload) {
    const candidate = plainObject(payload.foresightTermResult)
    if (!candidate || candidate.source !== 'OFFICIAL_PDF' || candidate.premiumMode !== 'Monthly' ||
      !positiveAmounts(candidate, CONFIRMED_AMOUNTS)) {
      return null
    }
    return {
      solveBasis: 'DEATH_BENEFIT',
      requestedAmount: candidate.confirmedFaceAmount as number,
      confirmedFaceAmount: candidate.confirmedFaceAmount as number,
      confirmedMonthlyPremium: candidate.confirmedMonthlyPremium as number,
      confirmedAnnualPremium: candidate.confirmedAnnualPremium as number,
    }
  }

  const candidate = plainObject(payload.foresightResult)
  if (!candidate || !['DEATH_BENEFIT', 'PREMIUM'].includes(String(candidate.solveBasis)) ||
    !positiveAmounts(candidate, ['requestedAmount', ...CONFIRMED_AMOUNTS])) {
    return null
  }
  return candidate as unknown as VerifiedForesightResult
}

/// The Quick View table K-Bot read in Foresight after the calculation, when
/// this illustration has one. Term never does.
export function foresightQuickReview(rawPayload: unknown): ForesightQuickReview | null {
  const payload = plainObject(rawPayload)
  const result = payload && plainObject(payload.foresightResult)
  if (!result || !('quickReview' in result)) return null
  return isForesightQuickReview(result.quickReview) ? result.quickReview : null
}
