import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import Decimal from 'decimal.js'
import {
  calculateLifeTargetPc,
  validateFrozenPromotionAttributions,
  validatePromotionCreditEvent,
  type FrozenPromotionAttribution,
} from '../promotion-credits'

export const NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE =
  'POLICY_TARGET_PREMIUM_RECONCILIATION'

export type NationalLifePromotionReversalReason =
  | 'NOT_TAKEN'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'CHARGEBACK'

export type NationalLifeReversalEvidence = {
  reason: NationalLifePromotionReversalReason
  field: string
  value: string
}

type DecimalLike = Decimal.Value | { toString(): string }

export type ReconciledPromotionCredit = {
  id: string
  carrier: string
  source: string
  externalId: string
  policyNumber: string | null
  producerAgentId: string
  targetPremium: DecimalLike | null
  anticipatedAnnualPremium: DecimalLike | null
  qualificationWeight: DecimalLike | null
}

export type NationalLifePromotionReconciliationCandidate = {
  id: string
  carrier: string
  source: typeof NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE
  externalId: string
  policyNumber: string | null
  producerAgentId: string
  targetPremium: Decimal | null
  anticipatedAnnualPremium: Decimal | null
  qualificationWeight: Decimal | null
  creditedPc: Decimal
  status: 'ADJUSTED' | 'REVERSED'
  recognizedAt: Date
  supersedesCreditId: string
  rawPayload: Prisma.InputJsonValue
  attributions: FrozenPromotionAttribution[]
}

export type PromotionReconciliationValidationCode =
  | 'INVALID_CURRENT_RECOGNIZED_PC'
  | 'INVALID_RECOGNITION_DATE'
  | 'ATTRIBUTION_PRODUCER_MISMATCH'

export class PromotionReconciliationValidationError extends Error {
  constructor(
    readonly code: PromotionReconciliationValidationCode,
    message: string,
  ) {
    super(message)
    this.name = 'PromotionReconciliationValidationError'
  }
}

const STATUS_FIELDS = [
  'PolicyStatus',
  'DerivedStatusDescription',
  'PlacementStatus',
  'PaidStatus',
  'PaymentStatus',
  'Status',
  'Disposition',
  'CloseReason',
  'Reason',
] as const

const EXPLICIT_EVIDENCE_FIELDS: ReadonlyArray<{
  reason: NationalLifePromotionReversalReason
  booleanFields: readonly string[]
  dateFields: readonly string[]
}> = [
  {
    reason: 'NOT_TAKEN',
    booleanFields: ['IsNotTaken', 'NotTakenIndicator'],
    dateFields: ['NotTakenDate'],
  },
  {
    reason: 'CANCELLED',
    booleanFields: ['IsCancelled', 'IsCanceled', 'CancelledIndicator', 'CanceledIndicator'],
    dateFields: ['CancellationDate', 'CancelledDate', 'CanceledDate', 'CancelDate'],
  },
  {
    reason: 'REFUNDED',
    booleanFields: ['IsRefunded', 'RefundedIndicator', 'PremiumRefundedIndicator'],
    dateFields: ['RefundDate', 'PremiumRefundDate'],
  },
  {
    reason: 'CHARGEBACK',
    booleanFields: ['IsChargeback', 'ChargebackIndicator'],
    dateFields: ['ChargebackDate'],
  },
]

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return text || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function isCarrierTrue(value: unknown) {
  if (value === true || value === 1) return true
  const text = scalarText(value)?.toUpperCase()
  return text === 'TRUE' || text === 'YES' || text === 'Y' || text === '1'
}

function normalizedStatus(value: string) {
  return value.toUpperCase().replace(/[_/\-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Detects only terminal carrier evidence that can reverse a previously
 * confirmed credit. Pending, declined, incomplete and generic unpaid statuses
 * intentionally do not qualify: they are not proof that paid business was
 * subsequently taken back.
 */
export function classifyNationalLifeReversalEvidence(input: {
  carrierStatus?: string | null
  raw: Record<string, unknown>
}): NationalLifeReversalEvidence | null {
  for (const evidence of EXPLICIT_EVIDENCE_FIELDS) {
    for (const field of evidence.booleanFields) {
      if (isCarrierTrue(input.raw[field])) {
        return { reason: evidence.reason, field, value: scalarText(input.raw[field]) ?? 'true' }
      }
    }
    for (const field of evidence.dateFields) {
      const value = scalarText(input.raw[field])
      if (value) return { reason: evidence.reason, field, value }
    }
  }

  const statuses: Array<{ field: string; value: string }> = []
  const carrierStatus = scalarText(input.carrierStatus)
  if (carrierStatus) statuses.push({ field: 'carrierStatus', value: carrierStatus })
  for (const field of STATUS_FIELDS) {
    const value = scalarText(input.raw[field])
    if (value) statuses.push({ field, value })
  }

  const matchers: ReadonlyArray<{
    reason: NationalLifePromotionReversalReason
    pattern: RegExp
  }> = [
    { reason: 'CHARGEBACK', pattern: /\bCHARGE\s*BACK\b/ },
    { reason: 'REFUNDED', pattern: /\bREFUND(?:ED)?\b|\bPREMIUM\s+RETURNED\b/ },
    { reason: 'NOT_TAKEN', pattern: /\bNOT\s+TAKEN\b/ },
    { reason: 'CANCELLED', pattern: /\bCANCEL(?:LED|ED|LATION)?\b/ },
  ]

  for (const matcher of matchers) {
    const matched = statuses.find(({ value }) => matcher.pattern.test(normalizedStatus(value)))
    if (matched) return { reason: matcher.reason, ...matched }
  }
  return null
}

function decimal(value: DecimalLike, label: string): Decimal {
  let parsed: Decimal
  try {
    parsed = new Decimal(value.toString())
  } catch {
    throw new PromotionReconciliationValidationError(
      'INVALID_CURRENT_RECOGNIZED_PC',
      `${label} must be numeric`,
    )
  }
  if (!parsed.isFinite()) {
    throw new PromotionReconciliationValidationError(
      'INVALID_CURRENT_RECOGNIZED_PC',
      `${label} must be finite`,
    )
  }
  return parsed
}

function optionalDecimal(value: DecimalLike | null): Decimal | null {
  return value === null ? null : new Decimal(value.toString())
}

function validRecognitionDate(value: Date) {
  if (Number.isNaN(value.getTime())) {
    throw new PromotionReconciliationValidationError(
      'INVALID_RECOGNITION_DATE',
      'Reconciliation recognition date must be valid',
    )
  }
  return new Date(value)
}

function copiedAttributions(
  producerAgentId: string,
  attributions: readonly FrozenPromotionAttribution[],
) {
  const normalized = validateFrozenPromotionAttributions(attributions)
  const personal = normalized.find((attribution) => attribution.kind === 'PERSONAL')
  if (personal?.agentId !== producerAgentId) {
    throw new PromotionReconciliationValidationError(
      'ATTRIBUTION_PRODUCER_MISMATCH',
      'Frozen personal attribution must belong to the original producer',
    )
  }
  return normalized.map((attribution) => ({ ...attribution }))
}

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash('sha256').update(parts.join('\u001f')).digest('hex')
  return `${prefix}_${digest.slice(0, 40)}`
}

function jsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Creates one idempotent negative event for a confirmed policy. The caller must
 * pass the current recognized total after resolving any prior adjustments; this
 * prevents reversing only the original amount and accidentally leaving an
 * adjustment behind. Replays and later terminal labels share the same key.
 */
export function prepareNationalLifePromotionReversal(input: {
  original: ReconciledPromotionCredit
  currentRecognizedPc: DecimalLike
  attributions: readonly FrozenPromotionAttribution[]
  recognizedAt: Date
  evidence: NationalLifeReversalEvidence
  carrierSnapshot?: unknown
}): NationalLifePromotionReconciliationCandidate | null {
  const currentRecognizedPc = decimal(input.currentRecognizedPc, 'Current recognized PC')
  // A replay that resolves the complete chain after its first reversal has no
  // remaining balance. Treat it as an idempotent no-op rather than an error.
  if (currentRecognizedPc.isZero()) return null
  if (currentRecognizedPc.isNegative()) {
    throw new PromotionReconciliationValidationError(
      'INVALID_CURRENT_RECOGNIZED_PC',
      'Current recognized PC cannot be negative before a reversal',
    )
  }
  const creditedPc = validatePromotionCreditEvent({
    status: 'REVERSED',
    creditedPc: currentRecognizedPc.negated(),
    supersedesCreditId: input.original.id,
  })
  const externalId = `${input.original.externalId}:REVERSED`

  return {
    id: stableId(
      'pcnlr',
      input.original.carrier,
      NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
      externalId,
    ),
    carrier: input.original.carrier,
    source: NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
    externalId,
    policyNumber: input.original.policyNumber,
    producerAgentId: input.original.producerAgentId,
    targetPremium: optionalDecimal(input.original.targetPremium),
    anticipatedAnnualPremium: optionalDecimal(input.original.anticipatedAnnualPremium),
    qualificationWeight: optionalDecimal(input.original.qualificationWeight),
    creditedPc,
    status: 'REVERSED',
    recognizedAt: validRecognitionDate(input.recognizedAt),
    supersedesCreditId: input.original.id,
    rawPayload: jsonPayload({
      reconciliation: {
        reason: input.evidence.reason,
        evidenceField: input.evidence.field,
        evidenceValue: input.evidence.value,
        originalCreditId: input.original.id,
        currentRecognizedPc: currentRecognizedPc.toString(),
      },
      carrierSnapshot: input.carrierSnapshot ?? null,
    }),
    attributions: copiedAttributions(
      input.original.producerAgentId,
      input.attributions,
    ),
  }
}

/**
 * Builds a signed delta only when the caller knows the complete currently
 * recognized total for the policy. If the chain cannot be resolved safely, the
 * writer must not call this helper and should preserve NEEDS_REVIEW instead.
 */
export function prepareNationalLifePromotionAdjustment(input: {
  original: ReconciledPromotionCredit
  supersedesCreditId: string
  currentRecognizedPc: DecimalLike
  targetPremium: DecimalLike
  anticipatedAnnualPremium: DecimalLike
  qualificationWeight: DecimalLike
  attributions: readonly FrozenPromotionAttribution[]
  recognizedAt: Date
  carrierSnapshot?: unknown
}): NationalLifePromotionReconciliationCandidate | null {
  const currentRecognizedPc = decimal(input.currentRecognizedPc, 'Current recognized PC')
  if (currentRecognizedPc.isNegative()) {
    throw new PromotionReconciliationValidationError(
      'INVALID_CURRENT_RECOGNIZED_PC',
      'Current recognized PC cannot be negative before an adjustment',
    )
  }
  const targetPremium = decimal(input.targetPremium, 'Target Premium')
  const anticipatedAnnualPremium = decimal(
    input.anticipatedAnnualPremium,
    'Anticipated Annual Premium',
  )
  const qualificationWeight = decimal(input.qualificationWeight, 'Qualification weight')
  const nextRecognizedPc = calculateLifeTargetPc({
    targetPremium,
    anticipatedAnnualPremium,
    qualificationWeight,
  })
  const creditedPc = nextRecognizedPc.minus(currentRecognizedPc)
  if (creditedPc.isZero()) return null
  validatePromotionCreditEvent({
    status: 'ADJUSTED',
    creditedPc,
    supersedesCreditId: input.supersedesCreditId,
  })

  const factsFingerprint = createHash('sha256')
    .update(
      [
        targetPremium.toString(),
        anticipatedAnnualPremium.toString(),
        qualificationWeight.toString(),
      ].join('\u001f'),
    )
    .digest('hex')
    .slice(0, 20)
  const externalId = `${input.original.externalId}:ADJUSTED:${factsFingerprint}`

  return {
    id: stableId(
      'pcnla',
      input.original.carrier,
      NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
      externalId,
    ),
    carrier: input.original.carrier,
    source: NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
    externalId,
    policyNumber: input.original.policyNumber,
    producerAgentId: input.original.producerAgentId,
    targetPremium,
    anticipatedAnnualPremium,
    qualificationWeight,
    creditedPc,
    status: 'ADJUSTED',
    recognizedAt: validRecognitionDate(input.recognizedAt),
    supersedesCreditId: input.supersedesCreditId,
    rawPayload: jsonPayload({
      reconciliation: {
        reason: 'CARRIER_VALUE_CHANGED',
        originalCreditId: input.original.id,
        supersedesCreditId: input.supersedesCreditId,
        previousRecognizedPc: currentRecognizedPc.toString(),
        nextRecognizedPc: nextRecognizedPc.toString(),
      },
      carrierSnapshot: input.carrierSnapshot ?? null,
    }),
    attributions: copiedAttributions(
      input.original.producerAgentId,
      input.attributions,
    ),
  }
}
