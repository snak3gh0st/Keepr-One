import Decimal from 'decimal.js'

export const PROMOTION_CREDIT_STATUSES = [
  'ESTIMATED',
  'PENDING_CARRIER',
  'CONFIRMED',
  'ADJUSTED',
  'REVERSED',
] as const

export type PromotionCreditStatus = (typeof PROMOTION_CREDIT_STATUSES)[number]

export type PromotionCreditValidationCode =
  | 'MISSING_TARGET_PREMIUM'
  | 'MISSING_ANTICIPATED_ANNUAL_PREMIUM'
  | 'INVALID_TARGET_PREMIUM'
  | 'INVALID_ANTICIPATED_ANNUAL_PREMIUM'
  | 'INVALID_QUALIFICATION_WEIGHT'
  | 'INVALID_CREDITED_PC'
  | 'INVALID_CREDIT_DELTA_SIGN'
  | 'MISSING_SUPERSEDED_CREDIT'
  | 'MISSING_PERSONAL_ATTRIBUTION'
  | 'DUPLICATE_ATTRIBUTION'
  | 'INVALID_ATTRIBUTION_AGENT'
  | 'INVALID_ATTRIBUTION_LEADER'
  | 'ATTRIBUTION_AGENT_MISMATCH'

export class PromotionCreditValidationError extends Error {
  constructor(
    readonly code: PromotionCreditValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'PromotionCreditValidationError'
  }
}

export type LifeTargetPcInput = {
  /// Carrier Target Premium / CTP for the issued business.
  targetPremium: Decimal.Value | null | undefined
  /// Anticipated Annual Premium is a separate carrier fact, never a CTP alias.
  anticipatedAnnualPremium: Decimal.Value | null | undefined
  /// Product/contract qualification factor from the official promotion rules.
  qualificationWeight: Decimal.Value
}

function requiredDecimal(
  value: Decimal.Value | null | undefined,
  missingCode:
    | 'MISSING_TARGET_PREMIUM'
    | 'MISSING_ANTICIPATED_ANNUAL_PREMIUM',
  invalidCode:
    | 'INVALID_TARGET_PREMIUM'
    | 'INVALID_ANTICIPATED_ANNUAL_PREMIUM',
  label: string,
): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new PromotionCreditValidationError(missingCode, `${label} is required`)
  }

  let decimal: Decimal
  try {
    decimal = new Decimal(value)
  } catch {
    throw new PromotionCreditValidationError(invalidCode, `${label} must be numeric`)
  }

  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new PromotionCreditValidationError(
      invalidCode,
      `${label} must be a finite, non-negative value`,
    )
  }
  return decimal
}

function nonNegativeWeight(value: Decimal.Value): Decimal {
  let weight: Decimal
  try {
    weight = new Decimal(value)
  } catch {
    throw new PromotionCreditValidationError(
      'INVALID_QUALIFICATION_WEIGHT',
      'Qualification weight must be numeric',
    )
  }

  if (!weight.isFinite() || weight.isNegative()) {
    throw new PromotionCreditValidationError(
      'INVALID_QUALIFICATION_WEIGHT',
      'Qualification weight must be a finite, non-negative value',
    )
  }
  return weight
}

/**
 * Official life-production formula used by the promotion ledger:
 *
 *     PC = min(Target Premium / CTP, AAP) × qualification weight
 *
 * Commission dollars are intentionally absent from the input. Missing carrier
 * facts fail closed instead of silently falling back to premium or commission.
 * The Decimal result is not rounded here; persistence owns display precision.
 */
export function calculateLifeTargetPc(input: LifeTargetPcInput): Decimal {
  const targetPremium = requiredDecimal(
    input.targetPremium,
    'MISSING_TARGET_PREMIUM',
    'INVALID_TARGET_PREMIUM',
    'Target Premium / CTP',
  )
  const anticipatedAnnualPremium = requiredDecimal(
    input.anticipatedAnnualPremium,
    'MISSING_ANTICIPATED_ANNUAL_PREMIUM',
    'INVALID_ANTICIPATED_ANNUAL_PREMIUM',
    'Anticipated Annual Premium',
  )
  const qualificationWeight = nonNegativeWeight(input.qualificationWeight)

  return Decimal.min(targetPremium, anticipatedAnnualPremium).times(qualificationWeight)
}

export type PromotionCreditEventDraft = {
  status: PromotionCreditStatus
  creditedPc: Decimal.Value
  supersedesCreditId?: string | null
}

/**
 * Validates the signed event delta before it is appended to the ledger.
 * ESTIMATED/PENDING/CONFIRMED events cannot remove PC. Corrections carry their
 * own sign and reversals are negative deltas linked to the event they reverse.
 */
export function validatePromotionCreditEvent(input: PromotionCreditEventDraft): Decimal {
  let creditedPc: Decimal
  try {
    creditedPc = new Decimal(input.creditedPc)
  } catch {
    throw new PromotionCreditValidationError(
      'INVALID_CREDITED_PC',
      'Credited PC must be numeric',
    )
  }

  if (!creditedPc.isFinite()) {
    throw new PromotionCreditValidationError(
      'INVALID_CREDITED_PC',
      'Credited PC must be finite',
    )
  }

  if (input.status === 'ADJUSTED' || input.status === 'REVERSED') {
    if (!input.supersedesCreditId?.trim()) {
      throw new PromotionCreditValidationError(
        'MISSING_SUPERSEDED_CREDIT',
        `${input.status} events must reference the event they correct`,
      )
    }
  }

  const invalidSign =
    ((input.status === 'ESTIMATED' ||
      input.status === 'PENDING_CARRIER' ||
      input.status === 'CONFIRMED') &&
      creditedPc.isNegative()) ||
    (input.status === 'ADJUSTED' && creditedPc.isZero()) ||
    (input.status === 'REVERSED' && !creditedPc.isNegative())

  if (invalidSign) {
    throw new PromotionCreditValidationError(
      'INVALID_CREDIT_DELTA_SIGN',
      `Credited PC has an invalid sign for ${input.status}`,
    )
  }

  return creditedPc
}

export function isRecognizedPromotionCreditStatus(status: PromotionCreditStatus): boolean {
  return status === 'CONFIRMED' || status === 'ADJUSTED' || status === 'REVERSED'
}

export type FrozenPromotionAttribution = {
  kind: 'PERSONAL' | 'AGENCY'
  /// Producer whose business generated the credit.
  agentId: string
  /// Leader who owned the producer at recognition time; AGENCY only.
  leaderAgentId?: string | null
}

/**
 * Freezes the personal/agency ownership written beside an event. There is one
 * PERSONAL row for the producer and one AGENCY row for each eligible upline at
 * recognition time. Every agency row must refer to that same producer, and a
 * leader may appear only once for the credit.
 */
export function validateFrozenPromotionAttributions(
  attributions: readonly FrozenPromotionAttribution[],
): FrozenPromotionAttribution[] {
  const normalized: FrozenPromotionAttribution[] = []
  const agencyLeaderIds = new Set<string>()
  let personalAgentId: string | null = null

  for (const attribution of attributions) {
    const agentId = attribution.agentId.trim()
    if (!agentId) {
      throw new PromotionCreditValidationError(
        'INVALID_ATTRIBUTION_AGENT',
        'Attribution agent is required',
      )
    }
    if (attribution.kind === 'PERSONAL') {
      if (personalAgentId !== null) {
        throw new PromotionCreditValidationError(
          'DUPLICATE_ATTRIBUTION',
          'Only one PERSONAL attribution is allowed per credit',
        )
      }
      if (attribution.leaderAgentId?.trim()) {
        throw new PromotionCreditValidationError(
          'INVALID_ATTRIBUTION_LEADER',
          'A personal attribution cannot have a leader',
        )
      }
      personalAgentId = agentId
      normalized.push({ kind: 'PERSONAL', agentId, leaderAgentId: null })
      continue
    }

    const leaderAgentId = attribution.leaderAgentId?.trim()
    if (!leaderAgentId) {
      throw new PromotionCreditValidationError(
        'INVALID_ATTRIBUTION_LEADER',
        'An agency attribution must freeze its leader',
      )
    }
    if (leaderAgentId === agentId) {
      throw new PromotionCreditValidationError(
        'INVALID_ATTRIBUTION_LEADER',
        'A producer cannot be their own agency upline',
      )
    }
    if (agencyLeaderIds.has(leaderAgentId)) {
      throw new PromotionCreditValidationError(
        'DUPLICATE_ATTRIBUTION',
        'Only one AGENCY attribution is allowed per leader and credit',
      )
    }
    agencyLeaderIds.add(leaderAgentId)
    normalized.push({ kind: 'AGENCY', agentId, leaderAgentId })
  }

  if (!personalAgentId) {
    throw new PromotionCreditValidationError(
      'MISSING_PERSONAL_ATTRIBUTION',
      'Every promotion credit needs one personal attribution',
    )
  }

  if (normalized.some((attribution) => attribution.agentId !== personalAgentId)) {
    throw new PromotionCreditValidationError(
      'ATTRIBUTION_AGENT_MISMATCH',
      'Personal and agency attributions must reference the same producer',
    )
  }

  return normalized
}
