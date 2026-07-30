/// The National Life "Rapid Solve" illustration contract.
///
/// Read out of the carrier's own bundle (`/Assets/Agent/js/rapidsolve.js`) with
/// a GET for a static asset — no quote was ever submitted to learn it, which
/// matters because a submission would be the first write this integration makes
/// against a real agent account.
///
/// Replaces `lib/policy-quote.ts`'s local formula on the illustration screen.
/// That formula produced plausible numbers that were not the carrier's, which is
/// worse than no number at all: it looks like an answer.
export const RAPID_SOLVE_PATH = '/agent/RapidSolve/GetQuote'

/// Which side of the illustration the carrier solves for. The screen shows
/// these as three buttons; `Specify_Amount` means "I give the face amount, tell
/// me the premium", and the other two mean "I give the premium, tell me the
/// death benefit" under different optimisation goals.
export const SOLVE_TYPES = {
  SPECIFY_AMOUNT: 'Specify_Amount',
  PREMIUM_DEATH_BENEFIT_FOCUS: 'Premium-DeathBenefitFocus',
  PREMIUM_ACCUMULATION_FOCUS: 'Premium-AccumulationFocus',
} as const

export type SolveType = (typeof SOLVE_TYPES)[keyof typeof SOLVE_TYPES]

export type RapidSolveInput = {
  issueState: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  gender: string
  rateClass: string
  solveType: SolveType
  /// Face amount when solving for premium, premium when solving for benefit.
  /// The carrier takes one field for both, keyed by solveType.
  amount: number
  deathBenefitOption: string
  strategy: string
  allocation: number
  /// Defaults to the code the carrier's own script hardcodes. It is a field
  /// rather than a constant because the screen has to quote Term as well as
  /// IUL, and whether this endpoint reaches Term is still unanswered — keeping
  /// it in the input means the answer changes a caller, not the transport.
  productCode?: string
}

export type RapidSolveRequest = {
  IssueState: string
  FirstName: string
  LastName: string
  DateOfBirth: string
  IssueAge: number
  Gender: string
  RateClass: string
  SolveType: string
  Amount: number
  DeathBenefitOption: string
  Strategy: string
  Allocation: number
  ProductCode: string
  PremiumMode: string
}

// Both are hardcoded in the carrier's own script rather than chosen in the UI.
// Named here so that if a quote ever comes back for the wrong product, the
// reason is visible instead of buried in a literal.
//
// The product code stays the default rather than the only value: it is what the
// carrier's Rapid Solve screen sends, so it is the only code known to work, but
// it has not been confirmed which product it is nor whether Term is reachable.
export const RAPID_SOLVE_PRODUCT_CODE = '956'
export const RAPID_SOLVE_PREMIUM_MODE = 'Monthly'

/// Age nearest birthday, which is what the carrier's field means — its script
/// calls it ANB. It is not age last birthday: someone seven months past their
/// 40th is 41 to an underwriter, and using the wrong one quietly misprices
/// every quote by a year.
export function issueAgeFrom(dateOfBirth: Date, on: Date): number {
  const lastBirthday = new Date(
    Date.UTC(on.getUTCFullYear(), dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()),
  )
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  if (lastBirthday.getTime() > on.getTime()) {
    lastBirthday.setUTCFullYear(lastBirthday.getUTCFullYear() - 1)
    age -= 1
  }
  const nextBirthday = new Date(lastBirthday)
  nextBirthday.setUTCFullYear(nextBirthday.getUTCFullYear() + 1)

  const sinceLast = on.getTime() - lastBirthday.getTime()
  const untilNext = nextBirthday.getTime() - on.getTime()
  return untilNext < sinceLast ? age + 1 : age
}

/// The carrier's date picker submits MM/DD/YYYY, so that is what the endpoint
/// expects — not ISO.
export function toCarrierDate(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}/${day}/${date.getUTCFullYear()}`
}

export function buildRapidSolveRequest(input: RapidSolveInput, on: Date): RapidSolveRequest {
  return {
    IssueState: input.issueState,
    FirstName: input.firstName,
    LastName: input.lastName,
    DateOfBirth: toCarrierDate(input.dateOfBirth),
    IssueAge: issueAgeFrom(input.dateOfBirth, on),
    Gender: input.gender,
    RateClass: input.rateClass,
    SolveType: input.solveType,
    Amount: input.amount,
    DeathBenefitOption: input.deathBenefitOption,
    Strategy: input.strategy,
    Allocation: Math.trunc(input.allocation),
    ProductCode: input.productCode ?? RAPID_SOLVE_PRODUCT_CODE,
    PremiumMode: RAPID_SOLVE_PREMIUM_MODE,
  }
}

export type RapidSolveQuote = {
  ok: true
  faceAmount: number
  annualPremium: number
  monthlyPremium: number
  /// The year the policy is projected to lapse. The carrier sends 0 to mean
  /// "does not lapse", which is the opposite of what a 0 normally reads as, so
  /// it becomes null here rather than year zero.
  lapseYear: number | null
}

export type RapidSolveFailure = { ok: false; message: string }

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function parseRapidSolveResponse(raw: unknown): RapidSolveQuote | RapidSolveFailure {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'A seguradora respondeu em formato inesperado.' }
  }
  const payload = raw as Record<string, unknown>

  // The carrier signals failure in the body with a 200, so status alone is not
  // enough to tell a quote from a refusal.
  if (payload.Success !== true) {
    const message =
      typeof payload.Message === 'string' && payload.Message.trim() !== ''
        ? payload.Message
        : 'A seguradora não conseguiu calcular esta illustration.'
    return { ok: false, message }
  }

  const faceAmount = numberFrom(payload.FaceAmount)
  const annualPremium = numberFrom(payload.AnnualPremium)
  const monthlyPremium = numberFrom(payload.MonthlyPremium)

  // A "successful" quote with no figures is not a quote. Reporting it as one
  // would put zeros on screen that look like the carrier's answer.
  if (faceAmount === null && annualPremium === null && monthlyPremium === null) {
    return { ok: false, message: 'A seguradora respondeu sem valores.' }
  }

  const lapseYear = numberFrom(payload.LapseYear)
  return {
    ok: true,
    faceAmount: faceAmount ?? 0,
    annualPremium: annualPremium ?? 0,
    monthlyPremium: monthlyPremium ?? 0,
    lapseYear: lapseYear === null || lapseYear === 0 ? null : lapseYear,
  }
}
