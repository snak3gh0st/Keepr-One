import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import Decimal from 'decimal.js'
import { getPromotionWindow, rollupPromotionCredits } from '../agent-promotion'
import { getUplineIds, type AgentNode } from '../hierarchy'
import { prisma } from '../prisma'
import {
  calculateLifeTargetPc,
  validateFrozenPromotionAttributions,
  type FrozenPromotionAttribution,
} from '../promotion-credits'
import { getPromotionJourney } from '../promotion-journey'
import type { CaseSnapshot } from './case-snapshot-service'
import type { InforcePolicySnapshot } from './inforce-policy-service'
import { COMMISSION_EARNING_GRID_KEYS } from './commission-grid-keys'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'
import type { NationalLifeGridKey } from './portal-grid-client'
import {
  toNationalLifePromotionPaymentEvidence,
  type NationalLifePromotionPaymentEvidence,
} from './promotion-payment-evidence'
import {
  NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
  PromotionReconciliationValidationError,
  classifyNationalLifeReversalEvidence,
  prepareNationalLifePromotionReversal,
  type NationalLifePromotionReconciliationCandidate,
  type NationalLifeReversalEvidence,
} from './promotion-credit-reconciliation'

const NATIONAL_LIFE_CARRIER = 'NATIONAL_LIFE'
const POLICY_TARGET_PREMIUM_SOURCE = 'POLICY_TARGET_PREMIUM'
const POLICY_TARGET_PREMIUM_PENDING_SOURCE = 'POLICY_TARGET_PREMIUM_PENDING'
const TARGET_PREMIUM_QUALIFICATION_WEIGHT = new Decimal(1)
const WRITE_CHUNK_SIZE = 250

export const NATIONAL_LIFE_PROMOTION_RULE_SET_VERSION = 'NATIONAL_LIFE_2026_TARGET_V1'

const PAID_STATUS_FIELDS = [
  'PaidStatus',
  'PaymentStatus',
  'PolicyStatus',
  'DerivedStatusDescription',
  'PlacementStatus',
  'Status',
] as const

const PAID_BOOLEAN_FIELDS = ['IsPaid', 'PaidIndicator', 'PolicyPaidIndicator'] as const

const PAID_DATE_FIELDS = [
  'PaidDate',
  'PolicyPaidDate',
  'DatePaid',
  'PaymentDate',
  'ProductionCreditDate',
  'FirstYearPaidDate',
] as const

export type NationalLifePromotionSkipReason =
  | 'NOT_CARRIER_PAID'
  | 'MISSING_TARGET_PREMIUM'
  | 'INVALID_TARGET_PREMIUM'
  | 'MISSING_AAP'
  | 'INVALID_AAP'
  | 'MISSING_RECOGNITION_DATE'
  | 'INVALID_RECOGNITION_DATE'
  | 'ZERO_PC'
  | 'CARRIER_VALUE_CHANGED_REQUIRES_ADJUSTMENT'
  | 'REVERSAL_WITHOUT_CONFIRMED_CREDIT'
  | 'RECONCILIATION_CHAIN_NEEDS_REVIEW'
  | 'PRODUCER_IDENTITY_MISMATCH'
  | 'PROMOTION_WRITER_FAILED'

export type NationalLifePromotionCandidate = {
  id: string
  carrier: typeof NATIONAL_LIFE_CARRIER
  source: typeof POLICY_TARGET_PREMIUM_SOURCE
  externalId: string
  policyNumber: string
  producerAgentId: string
  targetPremium: Decimal
  anticipatedAnnualPremium: Decimal
  qualificationWeight: Decimal
  creditedPc: Decimal
  status: 'CONFIRMED'
  recognizedAt: Date
  rawPayload: Prisma.InputJsonValue
  attributions: FrozenPromotionAttribution[]
}

export type NationalLifePendingPromotionCandidate = Omit<
  NationalLifePromotionCandidate,
  'source' | 'status'
> & {
  source: typeof POLICY_TARGET_PREMIUM_PENDING_SOURCE
  status: 'PENDING_CARRIER'
}

type PromotionWriteCandidate =
  | NationalLifePromotionCandidate
  | NationalLifePendingPromotionCandidate
  | NationalLifePromotionReconciliationCandidate

export type PrepareNationalLifePromotionResult =
  | { candidate: NationalLifePromotionCandidate; skipped: null }
  | { candidate: null; skipped: NationalLifePromotionSkipReason }

export type PrepareNationalLifePendingPromotionResult =
  | { candidate: NationalLifePendingPromotionCandidate; skipped: null }
  | { candidate: null; skipped: NationalLifePromotionSkipReason }

export type PromotionCreditSyncResult = {
  status: 'SYNCED' | 'NEEDS_REVIEW'
  examined: number
  eligible: number
  inserted: number
  skipped: Partial<Record<NationalLifePromotionSkipReason, number>>
}

type PromotionSource = {
  surface:
    | 'CASE_SNAPSHOT'
    | 'INFORCE_POLICY'
    | 'COMMISSION_EARNING'
    | 'POLICY_DETAIL'
  policyNumber: string
  producerAgentId: string
  carrierStatus: string | null
  targetPremium: string | null
  anticipatedAnnualPremium: string | null
  fetchedAt: Date
  raw: Record<string, unknown>
}

type PreparedReversal =
  | { candidate: NationalLifePromotionReconciliationCandidate; skipped: null }
  | { candidate: null; skipped: NationalLifePromotionSkipReason | null }

export type PromotionDatabase = Pick<PrismaClient, '$transaction' | 'agent'> &
  Partial<
    Pick<
      PrismaClient,
      | 'nationalLifePolicyDetailSnapshot'
      | 'nationalLifePublishedReportRow'
      | 'nationalLifeReportRow'
    >
  >

type PolicyDetailFacts = {
  policyNumber: string
  ctp: { toString(): string } | null
  anticipatedAnnualPremium: { toString(): string } | null
  observedAt: Date
}

function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash('sha256').update(parts.join('\u001f')).digest('hex')
  return `${prefix}_${digest.slice(0, 40)}`
}

function canonicalPolicyNumber(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function detailMoney(value: { toString(): string } | null) {
  return value?.toString() ?? null
}

async function enrichSourcesWithPolicyDetail(
  sources: readonly PromotionSource[],
  input: { agentId: string; deploymentScope: string },
  database: PromotionDatabase,
): Promise<PromotionSource[]> {
  const repository = database.nationalLifePolicyDetailSnapshot
  if (!repository || sources.length === 0) return [...sources]

  const policyNumbers = [
    ...new Set(sources.map((source) => canonicalPolicyNumber(source.policyNumber))),
  ]
  const details = (await repository.findMany({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      policyNumber: { in: policyNumbers },
    },
    select: {
      policyNumber: true,
      ctp: true,
      anticipatedAnnualPremium: true,
      observedAt: true,
    },
  })) as PolicyDetailFacts[]
  const detailByPolicy = new Map(
    details.map((detail) => [canonicalPolicyNumber(detail.policyNumber), detail]),
  )

  return sources.map((source) => {
    const detail = detailByPolicy.get(canonicalPolicyNumber(source.policyNumber))
    if (!detail) return source

    const targetPremium = source.targetPremium ?? detailMoney(detail.ctp)
    const anticipatedAnnualPremium =
      source.anticipatedAnnualPremium ?? detailMoney(detail.anticipatedAnnualPremium)
    return {
      ...source,
      targetPremium,
      anticipatedAnnualPremium,
      raw: {
        ...source.raw,
        promotionFacts: {
          targetPremiumSource:
            source.targetPremium === null && detail.ctp !== null
              ? 'POLICY_DETAIL_CTP'
              : 'SOURCE_SURFACE',
          anticipatedAnnualPremiumSource:
            source.anticipatedAnnualPremium === null &&
            detail.anticipatedAnnualPremium !== null
              ? 'POLICY_DETAIL_AAP'
              : 'SOURCE_SURFACE',
          policyDetailObservedAt: detail.observedAt.toISOString(),
        },
      },
    }
  })
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return trimmed || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function carrierMoney(value: string | null): Decimal | null {
  if (!value) return null
  const normalized = value.trim().replace(/^US\s*/i, '').replace(/^\$/, '').replace(/,/g, '')
  if (!/^\+?\d+(?:\.\d+)?$/.test(normalized)) return null

  try {
    const amount = new Decimal(normalized)
    return amount.isFinite() && !amount.isNegative() ? amount : null
  } catch {
    return null
  }
}

function carrierPaidEvidence(source: PromotionSource): string | null {
  const statusCandidates = [
    source.carrierStatus,
    ...PAID_STATUS_FIELDS.map((field) => scalarText(source.raw[field])),
  ]
  const normalizedStatuses = statusCandidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) =>
      candidate.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(),
    )
  if (
    normalizedStatuses.some((status) =>
      /\b(?:NOT TAKEN|NOT PAID|UNPAID|PENDING|DECLINED|INCOMPLETE|CANCELLED|CANCELED)\b/.test(
        status,
      ),
    )
  ) {
    return null
  }

  // A carrier-owned paid/production-credit date is itself evidence that the
  // policy reached the creditable event. PolicyIssueDate is deliberately absent:
  // issue/active alone is not proof that National Life marked the policy paid.
  for (const field of PAID_DATE_FIELDS) {
    if (field === 'PaymentDate' && source.surface !== 'COMMISSION_EARNING') continue
    if (scalarText(source.raw[field])) return `${field} present`
  }

  for (const field of PAID_BOOLEAN_FIELDS) {
    if (source.raw[field] === true || scalarText(source.raw[field])?.toLowerCase() === 'true') {
      return `${field}=true`
    }
  }

  for (const status of normalizedStatuses) {
    if (/\bPAID\b/.test(status)) return status
  }

  return null
}

function parseCarrierDate(value: unknown): Date | null {
  const text = scalarText(value)
  if (!text) return null

  const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (usDate) {
    const month = Number(usDate[1])
    const day = Number(usDate[2])
    const year = Number(usDate[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date
    }
    return null
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (isoDate) {
    const year = Number(isoDate[1])
    const month = Number(isoDate[2])
    const day = Number(isoDate[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date
    }
    return null
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function recognitionDate(source: PromotionSource): {
  date: Date | null
  field: string | null
  invalid: boolean
} {
  for (const field of PAID_DATE_FIELDS) {
    if (field === 'PaymentDate' && source.surface !== 'COMMISSION_EARNING') continue
    const rawValue = source.raw[field]
    if (rawValue === null || rawValue === undefined || scalarText(rawValue) === null) continue
    const date = parseCarrierDate(rawValue)
    return { date, field, invalid: date === null }
  }

  return { date: null, field: null, invalid: false }
}

function jsonPayload(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export function prepareConfirmedNationalLifePromotionCredit(
  source: PromotionSource,
  attributions: readonly FrozenPromotionAttribution[],
): PrepareNationalLifePromotionResult {
  const paidEvidence = carrierPaidEvidence(source)
  if (!paidEvidence) return { candidate: null, skipped: 'NOT_CARRIER_PAID' }

  if (!source.targetPremium) return { candidate: null, skipped: 'MISSING_TARGET_PREMIUM' }
  const targetPremium = carrierMoney(source.targetPremium)
  if (!targetPremium) return { candidate: null, skipped: 'INVALID_TARGET_PREMIUM' }

  if (!source.anticipatedAnnualPremium) return { candidate: null, skipped: 'MISSING_AAP' }
  const anticipatedAnnualPremium = carrierMoney(source.anticipatedAnnualPremium)
  if (!anticipatedAnnualPremium) return { candidate: null, skipped: 'INVALID_AAP' }

  const recognition = recognitionDate(source)
  if (recognition.invalid) return { candidate: null, skipped: 'INVALID_RECOGNITION_DATE' }
  if (!recognition.date) return { candidate: null, skipped: 'MISSING_RECOGNITION_DATE' }

  const creditedPc = calculateLifeTargetPc({
    targetPremium,
    anticipatedAnnualPremium,
    // This writer accepts only the carrier's explicit CTP field. CTP is the
    // first-year target bucket weighted at 100%; excess premium and every other
    // production category need their own explicit writer and official weight.
    qualificationWeight: TARGET_PREMIUM_QUALIFICATION_WEIGHT,
  })
  if (creditedPc.isZero()) return { candidate: null, skipped: 'ZERO_PC' }

  const externalId = canonicalPolicyNumber(source.policyNumber)
  const id = stableId('pcnl', NATIONAL_LIFE_CARRIER, POLICY_TARGET_PREMIUM_SOURCE, externalId)

  return {
    candidate: {
      id,
      carrier: NATIONAL_LIFE_CARRIER,
      source: POLICY_TARGET_PREMIUM_SOURCE,
      externalId,
      // Store the same canonical policy identifier used by the idempotency key,
      // so case and in-force surfaces remain integrally identical on replay.
      policyNumber: externalId,
      producerAgentId: source.producerAgentId,
      targetPremium,
      anticipatedAnnualPremium,
      qualificationWeight: TARGET_PREMIUM_QUALIFICATION_WEIGHT,
      creditedPc,
      status: 'CONFIRMED',
      recognizedAt: recognition.date,
      rawPayload: jsonPayload({
        sourceSurface: source.surface,
        fetchedAt: source.fetchedAt.toISOString(),
        carrierPaidEvidence: paidEvidence,
        recognitionDateSource: recognition.field,
        carrierSnapshot: source.raw,
      }),
      attributions: validateFrozenPromotionAttributions(attributions),
    },
    skipped: null,
  }
}

export function preparePendingNationalLifePromotionCredit(
  source: PromotionSource,
  attributions: readonly FrozenPromotionAttribution[],
  pendingReason: 'NOT_CARRIER_PAID' | 'MISSING_RECOGNITION_DATE',
): PrepareNationalLifePendingPromotionResult {
  if (!source.targetPremium) return { candidate: null, skipped: 'MISSING_TARGET_PREMIUM' }
  const targetPremium = carrierMoney(source.targetPremium)
  if (!targetPremium) return { candidate: null, skipped: 'INVALID_TARGET_PREMIUM' }

  if (!source.anticipatedAnnualPremium) return { candidate: null, skipped: 'MISSING_AAP' }
  const anticipatedAnnualPremium = carrierMoney(source.anticipatedAnnualPremium)
  if (!anticipatedAnnualPremium) return { candidate: null, skipped: 'INVALID_AAP' }

  const creditedPc = calculateLifeTargetPc({
    targetPremium,
    anticipatedAnnualPremium,
    qualificationWeight: TARGET_PREMIUM_QUALIFICATION_WEIGHT,
  })
  if (creditedPc.isZero()) return { candidate: null, skipped: 'ZERO_PC' }

  const policyNumber = canonicalPolicyNumber(source.policyNumber)
  const factsFingerprint = createHash('sha256')
    .update(
      [
        targetPremium.toString(),
        anticipatedAnnualPremium.toString(),
        TARGET_PREMIUM_QUALIFICATION_WEIGHT.toString(),
      ].join('\u001f'),
    )
    .digest('hex')
    .slice(0, 16)
  const externalId = `${policyNumber}:PENDING:${factsFingerprint}`
  const id = stableId(
    'pcnlpending',
    NATIONAL_LIFE_CARRIER,
    POLICY_TARGET_PREMIUM_PENDING_SOURCE,
    externalId,
  )

  return {
    candidate: {
      id,
      carrier: NATIONAL_LIFE_CARRIER,
      source: POLICY_TARGET_PREMIUM_PENDING_SOURCE,
      externalId,
      policyNumber,
      producerAgentId: source.producerAgentId,
      targetPremium,
      anticipatedAnnualPremium,
      qualificationWeight: TARGET_PREMIUM_QUALIFICATION_WEIGHT,
      creditedPc,
      status: 'PENDING_CARRIER',
      // Pending observations are intentionally excluded from promotion
      // qualification. `recognizedAt` is the schema's timeline field; while the
      // carrier payment date is still unknown it records when KeeprOne observed
      // the complete CTP/AAP pair.
      recognizedAt: source.fetchedAt,
      rawPayload: jsonPayload({
        sourceSurface: source.surface,
        fetchedAt: source.fetchedAt.toISOString(),
        pendingReason,
        carrierSnapshot: source.raw,
      }),
      attributions: validateFrozenPromotionAttributions(attributions),
    },
    skipped: null,
  }
}

function sameDecimal(left: { toString(): string } | null, right: Decimal) {
  return left !== null && new Decimal(left.toString()).equals(right)
}

function sameOptionalDecimal(
  left: { toString(): string } | null,
  right: Decimal | null,
) {
  if (left === null || right === null) return left === null && right === null
  return sameDecimal(left, right)
}

function promotionCreditKey(value: {
  carrier: string
  source: string
  externalId: string
}) {
  return `${value.carrier}\u001f${value.source}\u001f${value.externalId}`
}

type StoredPromotionCreditIdentity = {
  id: string
  carrier: string
  source: string
  externalId: string
  policyNumber: string | null
  producerAgentId: string
  targetPremium: { toString(): string } | null
  anticipatedAnnualPremium: { toString(): string } | null
  qualificationWeight: { toString(): string } | null
  creditedPc: { toString(): string }
  status: string
  recognizedAt: Date
  supersedesCreditId: string | null
}

function samePromotionCreditIdentity(
  existing: StoredPromotionCreditIdentity,
  candidate: PromotionWriteCandidate,
) {
  const supersedesCreditId =
    'supersedesCreditId' in candidate ? candidate.supersedesCreditId : null
  return (
    existing.id === candidate.id &&
    existing.carrier === candidate.carrier &&
    existing.source === candidate.source &&
    existing.externalId === candidate.externalId &&
    existing.policyNumber === candidate.policyNumber &&
    existing.producerAgentId === candidate.producerAgentId &&
    sameOptionalDecimal(existing.targetPremium, candidate.targetPremium) &&
    sameOptionalDecimal(
      existing.anticipatedAnnualPremium,
      candidate.anticipatedAnnualPremium,
    ) &&
    sameOptionalDecimal(existing.qualificationWeight, candidate.qualificationWeight) &&
    sameDecimal(existing.creditedPc, candidate.creditedPc) &&
    existing.status === candidate.status &&
    existing.recognizedAt.getTime() === candidate.recognizedAt.getTime() &&
    existing.supersedesCreditId === supersedesCreditId
  )
}

const PROMOTION_CREDIT_IDENTITY_SELECT = {
  id: true,
  carrier: true,
  source: true,
  externalId: true,
  policyNumber: true,
  producerAgentId: true,
  targetPremium: true,
  anticipatedAnnualPremium: true,
  qualificationWeight: true,
  creditedPc: true,
  status: true,
  recognizedAt: true,
  supersedesCreditId: true,
} satisfies Prisma.PromotionCreditSelect

function creditCreateData(
  candidate: PromotionWriteCandidate,
): Prisma.PromotionCreditCreateManyInput {
  return {
    id: candidate.id,
    carrier: candidate.carrier,
    source: candidate.source,
    externalId: candidate.externalId,
    policyNumber: candidate.policyNumber,
    producerAgentId: candidate.producerAgentId,
    targetPremium: candidate.targetPremium,
    anticipatedAnnualPremium: candidate.anticipatedAnnualPremium,
    qualificationWeight: candidate.qualificationWeight,
    creditedPc: candidate.creditedPc,
    status: candidate.status,
    recognizedAt: candidate.recognizedAt,
    supersedesCreditId:
      'supersedesCreditId' in candidate ? candidate.supersedesCreditId : null,
    rawPayload: candidate.rawPayload,
  }
}

async function recordMonotonicAchievements(
  tx: Prisma.TransactionClient,
  agentIds: readonly string[],
  asOf: Date,
) {
  const { windowStart, windowEnd } = getPromotionWindow(asOf)

  for (const agentId of agentIds) {
    const agent = await tx.agent.findUnique({
      where: { id: agentId },
      select: { promotionAccessScope: true },
    })
    if (!agent) continue
    const rows = await tx.promotionCreditAttribution.findMany({
      where: {
        OR: [
          { kind: 'PERSONAL', agentId },
          { kind: 'AGENCY', leaderAgentId: agentId },
        ],
        promotionCredit: {
          recognizedAt: { gte: windowStart, lte: windowEnd },
        },
      },
      select: {
        kind: true,
        agentId: true,
        leaderAgentId: true,
        promotionCredit: {
          select: {
            id: true,
            carrier: true,
            policyNumber: true,
            producerAgentId: true,
            creditedPc: true,
            status: true,
            recognizedAt: true,
            createdAt: true,
          },
        },
      },
    })
    const totals = rollupPromotionCredits(rows, agentId)
    const journey = getPromotionJourney({
      personalPc: totals.personalPc,
      agencyPc: totals.agencyPc,
      mode: agent.promotionAccessScope === 'AGENCY' ? 'agency' : 'individual',
    })
    const achievements: Prisma.PromotionAchievementCreateManyInput[] = journey.stages.flatMap(
      (stage) => {
        // A later rank can make an earlier stage visually "achieved" even when
        // that earlier rule is not directly satisfied (inherited). Persist only
        // the ranks the rolling totals actually qualify for.
        if (
          stage.status !== 'achieved' ||
          stage.achievement !== 'qualified' ||
          !stage.qualificationRoute
        ) {
          return []
        }
        return [
          {
            // ID intentionally comes from Prisma's cuid default. The database
            // deduplicates one active achievement with a partial unique index,
            // while an administratively invalidated record remains historical
            // and may later be earned again under a new ID.
            agentId,
            rankId: stage.id,
            step: stage.step,
            route: stage.qualificationRoute.toUpperCase() as 'PERSONAL' | 'AGENCY',
            achievedAt: asOf,
            qualifyingWindowStart: windowStart,
            qualifyingWindowEnd: windowEnd,
            personalPc: totals.personalPc,
            agencyPc: totals.agencyPc,
            ruleSetVersion: NATIONAL_LIFE_PROMOTION_RULE_SET_VERSION,
          },
        ]
      },
    )

    if (achievements.length > 0) {
      await tx.promotionAchievement.createMany({ data: achievements, skipDuplicates: true })
    }
  }
}

async function prepareReversalCandidate(
  source: PromotionSource,
  evidence: NationalLifeReversalEvidence,
  database: PromotionDatabase,
): Promise<PreparedReversal> {
  const externalId = canonicalPolicyNumber(source.policyNumber)
  const credits = await database.$transaction((tx) =>
    tx.promotionCredit.findMany({
      where: {
        carrier: NATIONAL_LIFE_CARRIER,
        OR: [
          { source: POLICY_TARGET_PREMIUM_SOURCE, externalId },
          {
            source: NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
            externalId: { startsWith: `${externalId}:` },
          },
        ],
      },
      select: {
        id: true,
        carrier: true,
        source: true,
        externalId: true,
        policyNumber: true,
        producerAgentId: true,
        targetPremium: true,
        anticipatedAnnualPremium: true,
        qualificationWeight: true,
        creditedPc: true,
        status: true,
        recognizedAt: true,
        supersedesCreditId: true,
        createdAt: true,
        attributions: {
          select: { kind: true, agentId: true, leaderAgentId: true },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  )
  const original = credits.find(
    (credit) =>
      credit.source === POLICY_TARGET_PREMIUM_SOURCE && credit.externalId === externalId,
  )
  if (!original) {
    return { candidate: null, skipped: 'REVERSAL_WITHOUT_CONFIRMED_CREDIT' }
  }
  if (
    original.status !== 'CONFIRMED' ||
    original.producerAgentId !== source.producerAgentId
  ) {
    return { candidate: null, skipped: 'RECONCILIATION_CHAIN_NEEDS_REVIEW' }
  }

  const reconciliation = credits.filter(
    (credit) => credit.source === NATIONAL_LIFE_PROMOTION_RECONCILIATION_SOURCE,
  )
  let previousId = original.id
  for (const credit of reconciliation) {
    if (
      credit.producerAgentId !== original.producerAgentId ||
      credit.supersedesCreditId !== previousId ||
      (credit.status !== 'ADJUSTED' && credit.status !== 'REVERSED')
    ) {
      return { candidate: null, skipped: 'RECONCILIATION_CHAIN_NEEDS_REVIEW' }
    }
    previousId = credit.id
  }

  const currentRecognizedPc = credits.reduce(
    (sum, credit) => sum.plus(credit.creditedPc.toString()),
    new Decimal(0),
  )
  const attributions: FrozenPromotionAttribution[] = original.attributions.map(
    (attribution) => ({
      kind: attribution.kind,
      agentId: attribution.agentId,
      leaderAgentId: attribution.leaderAgentId,
    }),
  )

  try {
    const candidate = prepareNationalLifePromotionReversal({
      original,
      currentRecognizedPc,
      attributions,
      // The debit ages out with the original credit. Dating a reversal at the
      // observation time could subtract unrelated current production after the
      // original has already left the rolling 12-month window.
      recognizedAt: original.recognizedAt,
      evidence,
      carrierSnapshot: source.raw,
    })
    return { candidate, skipped: null }
  } catch (error) {
    if (error instanceof PromotionReconciliationValidationError) {
      return { candidate: null, skipped: 'RECONCILIATION_CHAIN_NEEDS_REVIEW' }
    }
    throw error
  }
}

async function appendCandidates(
  candidates: readonly PromotionWriteCandidate[],
  database: PromotionDatabase,
  asOf: Date,
): Promise<{ inserted: number; affectedAgentIds: string[]; review: number }> {
  let inserted = 0
  let review = 0
  const affectedAgentIds = new Set<string>()

  for (let offset = 0; offset < candidates.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = candidates.slice(offset, offset + WRITE_CHUNK_SIZE)
    const result = await database.$transaction(async (tx) => {
      const keys = chunk.map((candidate) => ({
        carrier: candidate.carrier,
        source: candidate.source,
        externalId: candidate.externalId,
      }))
      const existingBefore = await tx.promotionCredit.findMany({
        where: { OR: keys },
        select: PROMOTION_CREDIT_IDENTITY_SELECT,
      })
      const existingByKey = new Map(
        existingBefore.map((credit) => [
          promotionCreditKey(credit),
          credit,
        ]),
      )

      const acceptedKeys = new Set<string>()
      const insertedCandidates: PromotionWriteCandidate[] = []
      let insertedInTransaction = 0
      let reviewInTransaction = 0

      for (const candidate of chunk) {
        const key = promotionCreditKey(candidate)
        const existing = existingByKey.get(key)
        if (existing) {
          if (samePromotionCreditIdentity(existing, candidate)) acceptedKeys.add(key)
          else reviewInTransaction += 1
          continue
        }

        // Insert one idempotency key at a time. With skipDuplicates, the returned
        // count is the only reliable way to distinguish our insert from a
        // concurrent winner. The post-insert read then proves which immutable
        // event owns the key before any frozen attribution is written.
        const creditInsert = await tx.promotionCredit.createMany({
          data: [creditCreateData(candidate)],
          skipDuplicates: true,
        })
        const [stored] = await tx.promotionCredit.findMany({
          where: {
            carrier: candidate.carrier,
            source: candidate.source,
            externalId: candidate.externalId,
          },
          select: PROMOTION_CREDIT_IDENTITY_SELECT,
          take: 1,
        })

        if (!stored || !samePromotionCreditIdentity(stored, candidate)) {
          // A concurrent event owned by another producer or with different
          // carrier facts must never inherit this producer's uplines.
          reviewInTransaction += 1
          continue
        }

        acceptedKeys.add(key)
        if (creditInsert.count === 1) {
          insertedInTransaction += 1
          insertedCandidates.push(candidate)
        }
        // count=0 means a concurrent, fully identical writer won. Its own
        // transaction owns the atomic credit + frozen-attribution write.
      }

      const attributionRows: Prisma.PromotionCreditAttributionCreateManyInput[] =
        insertedCandidates.flatMap((candidate) =>
          candidate.attributions.map((attribution) => ({
            id: stableId(
              'pca',
              candidate.id,
              attribution.kind,
              attribution.leaderAgentId ?? attribution.agentId,
            ),
            promotionCreditId: candidate.id,
            kind: attribution.kind,
            agentId: attribution.agentId,
            leaderAgentId: attribution.leaderAgentId ?? null,
            frozenAt: asOf,
          })),
        )
      if (attributionRows.length > 0) {
        await tx.promotionCreditAttribution.createMany({
          data: attributionRows,
          skipDuplicates: true,
        })
      }

      const acceptedWhere = keys.filter((key) =>
        acceptedKeys.has(promotionCreditKey(key)),
      )
      const storedCredits =
        acceptedWhere.length === 0
          ? []
          : await tx.promotionCredit.findMany({
              where: { OR: acceptedWhere },
              select: {
                producerAgentId: true,
                attributions: { select: { agentId: true, leaderAgentId: true } },
              },
            })
      const affected = new Set<string>()
      for (const credit of storedCredits) {
        affected.add(credit.producerAgentId)
        for (const attribution of credit.attributions) {
          affected.add(attribution.agentId)
          if (attribution.leaderAgentId) affected.add(attribution.leaderAgentId)
        }
      }

      return {
        inserted: insertedInTransaction,
        affected: [...affected],
        review: reviewInTransaction,
      }
    })

    inserted += result.inserted
    review += result.review
    result.affected.forEach((agentId) => affectedAgentIds.add(agentId))
  }

  if (affectedAgentIds.size > 0) {
    await database.$transaction((tx) =>
      recordMonotonicAchievements(tx, [...affectedAgentIds], asOf),
    )
  }

  return { inserted, affectedAgentIds: [...affectedAgentIds], review }
}

async function syncSources(
  sources: readonly PromotionSource[],
  database: PromotionDatabase = prisma,
): Promise<PromotionCreditSyncResult> {
  const skipped: PromotionCreditSyncResult['skipped'] = {}
  if (sources.length === 0) {
    return { status: 'SYNCED', examined: 0, eligible: 0, inserted: 0, skipped }
  }

  const agents = (await database.agent.findMany({
    select: { id: true, parentAgentId: true },
  })) as AgentNode[]
  const agentIds = new Set(agents.map((agent) => agent.id))
  const candidates = new Map<string, PromotionWriteCandidate>()

  for (const source of sources) {
    if (!agentIds.has(source.producerAgentId)) {
      throw new Error(`Promotion producer ${source.producerAgentId} does not exist`)
    }
    const reversalEvidence = classifyNationalLifeReversalEvidence({
      carrierStatus: source.carrierStatus,
      raw: source.raw,
    })
    if (reversalEvidence) {
      const reversal = await prepareReversalCandidate(source, reversalEvidence, database)
      if (reversal.skipped) {
        skipped[reversal.skipped] = (skipped[reversal.skipped] ?? 0) + 1
      }
      if (reversal.candidate) {
        candidates.set(promotionCreditKey(reversal.candidate), reversal.candidate)
      }
      continue
    }

    const attributions: FrozenPromotionAttribution[] = [
      { kind: 'PERSONAL', agentId: source.producerAgentId },
      ...getUplineIds(agents, source.producerAgentId).map((leaderAgentId) => ({
        kind: 'AGENCY' as const,
        agentId: source.producerAgentId,
        leaderAgentId,
      })),
    ]
    const prepared = prepareConfirmedNationalLifePromotionCredit(source, attributions)
    if (prepared.candidate) {
      candidates.set(promotionCreditKey(prepared.candidate), prepared.candidate)
      continue
    }

    if (
      prepared.skipped === 'NOT_CARRIER_PAID' ||
      prepared.skipped === 'MISSING_RECOGNITION_DATE'
    ) {
      const pending = preparePendingNationalLifePromotionCredit(
        source,
        attributions,
        prepared.skipped,
      )
      if (pending.candidate) {
        candidates.set(promotionCreditKey(pending.candidate), pending.candidate)
        continue
      }
      skipped[pending.skipped] = (skipped[pending.skipped] ?? 0) + 1
      continue
    }

    skipped[prepared.skipped] = (skipped[prepared.skipped] ?? 0) + 1
  }

  const preparedCandidates = [...candidates.values()]
  const appended = await appendCandidates(preparedCandidates, database, new Date())
  if (appended.review > 0) {
    skipped.CARRIER_VALUE_CHANGED_REQUIRES_ADJUSTMENT = appended.review
  }
  const needsReview =
    appended.review > 0 ||
    Boolean(skipped.REVERSAL_WITHOUT_CONFIRMED_CREDIT) ||
    Boolean(skipped.RECONCILIATION_CHAIN_NEEDS_REVIEW)
  return {
    status: needsReview ? 'NEEDS_REVIEW' : 'SYNCED',
    examined: sources.length,
    eligible: preparedCandidates.length,
    inserted: appended.inserted,
    skipped,
  }
}

function canonicalCarrierAgentNumber(value: string | null | undefined) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || null
}

async function getActiveProducerNpn(
  agentId: string,
  database: PromotionDatabase,
): Promise<string | undefined | null> {
  const agent = await database.agent.findUnique({
    where: { id: agentId },
    select: { npn: true, status: true },
  })
  if (!agent || agent.status !== 'ACTIVE') return null
  // The signed connector/device is the ownership boundary. NPN is optional:
  // when present it adds a row-level identity check, but its absence must not
  // discard carrier data captured through that agent's authenticated account.
  return canonicalCarrierAgentNumber(agent.npn) ?? undefined
}

function withOwnershipSkips(
  result: PromotionCreditSyncResult,
  examined: number,
  rejected: number,
): PromotionCreditSyncResult {
  if (rejected === 0) return { ...result, examined }
  return {
    ...result,
    examined,
    skipped: {
      ...result.skipped,
      PRODUCER_IDENTITY_MISMATCH:
        (result.skipped.PRODUCER_IDENTITY_MISMATCH ?? 0) + rejected,
    },
  }
}

export async function syncConfirmedCasePromotionCredits(
  input: {
    agentId: string
    deploymentScope: string
    gridKey: NationalLifeGridKey
    snapshots: readonly CaseSnapshot[]
    fetchedAt: Date
  },
  database: PromotionDatabase = prisma,
) {
  const producerNpn = await getActiveProducerNpn(input.agentId, database)
  const ownedSnapshots = producerNpn === undefined
    ? input.snapshots
    : producerNpn
    ? input.snapshots.filter(
        (snapshot) =>
          canonicalCarrierAgentNumber(snapshot.writingAgentNumber) === producerNpn,
      )
    : []
  const sources = await enrichSourcesWithPolicyDetail(
    ownedSnapshots.map((snapshot): PromotionSource => ({
      surface: 'CASE_SNAPSHOT',
      policyNumber: snapshot.policyNo,
      // The signed connector account establishes ownership. When the optional
      // NPN exists, the filter above additionally verifies the carrier row.
      producerAgentId: input.agentId,
      carrierStatus: snapshot.carrierStatus,
      targetPremium: snapshot.targetPremium,
      anticipatedAnnualPremium: snapshot.anticipatedAnnualPremium,
      fetchedAt: input.fetchedAt,
      raw: {
        ...snapshot.raw,
        deploymentScope: input.deploymentScope,
        gridKey: input.gridKey,
      },
    })),
    input,
    database,
  )
  const result = await syncSources(
    sources,
    database,
  )
  return withOwnershipSkips(
    result,
    input.snapshots.length,
    input.snapshots.length - ownedSnapshots.length,
  )
}

export async function syncConfirmedInforcePromotionCredits(
  input: {
    agentId: string
    deploymentScope: string
    snapshots: readonly InforcePolicySnapshot[]
    fetchedAt: Date
  },
  database: PromotionDatabase = prisma,
) {
  const producerNpn = await getActiveProducerNpn(input.agentId, database)
  const ownedSnapshots = producerNpn === undefined
    ? input.snapshots
    : producerNpn
    ? input.snapshots.filter(
        (snapshot) =>
          canonicalCarrierAgentNumber(snapshot.agentNumber) === producerNpn,
      )
    : []
  const sources = await enrichSourcesWithPolicyDetail(
    ownedSnapshots.map((snapshot): PromotionSource => ({
      surface: 'INFORCE_POLICY',
      policyNumber: snapshot.policyNumber,
      // See the producer-identity contract documented in the case path above.
      producerAgentId: input.agentId,
      carrierStatus: snapshot.policyStatus,
      targetPremium: snapshot.targetPremium,
      anticipatedAnnualPremium: snapshot.anticipatedAnnualPremium,
      fetchedAt: input.fetchedAt,
      raw: {
        ...snapshot.raw,
        deploymentScope: input.deploymentScope,
      },
    })),
    input,
    database,
  )
  const result = await syncSources(
    sources,
    database,
  )
  return withOwnershipSkips(
    result,
    input.snapshots.length,
    input.snapshots.length - ownedSnapshots.length,
  )
}

function earliestPaymentByPolicy(
  evidence: readonly NationalLifePromotionPaymentEvidence[],
) {
  const byPolicy = new Map<string, NationalLifePromotionPaymentEvidence>()
  for (const item of evidence) {
    const current = byPolicy.get(item.policyNumber)
    if (!current || item.paymentDate < current.paymentDate) {
      byPolicy.set(item.policyNumber, item)
    }
  }
  return [...byPolicy.values()]
}

async function syncPaymentEvidence(
  input: {
    agentId: string
    deploymentScope: string
    evidence: readonly NationalLifePromotionPaymentEvidence[]
    fetchedAt: Date
  },
  database: PromotionDatabase,
) {
  const producerNpn = await getActiveProducerNpn(input.agentId, database)
  const ownedEvidence = producerNpn === undefined
    ? input.evidence
    : producerNpn
    ? input.evidence.filter(
        (item) => canonicalCarrierAgentNumber(item.writingAgentNumber) === producerNpn,
      )
    : []
  const uniqueEvidence = earliestPaymentByPolicy(ownedEvidence)
  const sources = await enrichSourcesWithPolicyDetail(
    uniqueEvidence.map((item): PromotionSource => ({
      surface: 'COMMISSION_EARNING',
      policyNumber: item.policyNumber,
      producerAgentId: input.agentId,
      carrierStatus: 'Paid',
      targetPremium: null,
      anticipatedAnnualPremium: null,
      fetchedAt: input.fetchedAt,
      // Only the narrow, typed payment proof reaches the promotion ledger.
      // Names, commission dollars and other report-row PII stay in their
      // original NationalLifeReportRow record.
      raw: {
        PaymentDate: item.paymentDateRaw,
        CompensationType: item.compensationType,
        TransactionType: item.transactionType,
        WritingAgtNumber: item.writingAgentNumber,
        IncomeClass: item.incomeClass,
        ProductType: item.productType,
        lifeEvidenceField: item.lifeEvidenceField,
        deploymentScope: input.deploymentScope,
        gridKey: 'COMMISSIONS_EARNING_REPORT',
      },
    })),
    input,
    database,
  )
  const result = await syncSources(sources, database)
  return withOwnershipSkips(
    result,
    input.evidence.length,
    input.evidence.length - ownedEvidence.length,
  )
}

/**
 * Composes the carrier's per-policy payment evidence with CTP/AAP captured on
 * Policy Detail. Commission and premium dollars are never calculation inputs.
 */
export async function syncNationalLifeCommissionPromotionCredits(
  input: {
    agentId: string
    deploymentScope: string
    rows: readonly unknown[]
    fetchedAt: Date
  },
  database: PromotionDatabase = prisma,
) {
  const evidence = input.rows.flatMap((row) => {
    const parsed = toNationalLifePromotionPaymentEvidence(row)
    return parsed ? [parsed] : []
  })
  return syncPaymentEvidence({ ...input, evidence }, database)
}

async function syncPolicyDetailPromotionCredits(
  input: {
    agentId: string
    deploymentScope: string
    policyNumber: string
    fetchedAt: Date
  },
  database: PromotionDatabase,
): Promise<PromotionCreditSyncResult> {
  const detailRepository = database.nationalLifePolicyDetailSnapshot
  if (!detailRepository) throw new Error('Policy detail promotion source unavailable')

  const policyNumber = canonicalPolicyNumber(input.policyNumber)
  const detail = (await detailRepository.findFirst({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      policyNumber,
    },
    select: {
      policyNumber: true,
      ctp: true,
      anticipatedAnnualPremium: true,
      observedAt: true,
    },
  })) as PolicyDetailFacts | null
  if (!detail) {
    return {
      status: 'SYNCED',
      examined: 0,
      eligible: 0,
      inserted: 0,
      skipped: {},
    }
  }

  const reportRows = input.deploymentScope === LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
    ? database.nationalLifePublishedReportRow
      ? await database.nationalLifePublishedReportRow.findMany({
          where: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
            label: policyNumber,
          },
          select: { raw: true },
        })
      : []
    : database.nationalLifeReportRow
      ? await database.nationalLifeReportRow.findMany({
        where: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
          label: policyNumber,
        },
        select: { raw: true },
      })
      : []
  const evidence = reportRows.flatMap((row) => {
    const parsed = toNationalLifePromotionPaymentEvidence(row)
    return parsed && parsed.policyNumber === policyNumber ? [parsed] : []
  })

  if (evidence.length > 0) {
    return syncPaymentEvidence({ ...input, evidence }, database)
  }

  const producerNpn = await getActiveProducerNpn(input.agentId, database)
  if (producerNpn === null) {
    return {
      status: 'SYNCED',
      examined: 1,
      eligible: 0,
      inserted: 0,
      skipped: { PRODUCER_IDENTITY_MISMATCH: 1 },
    }
  }

  // Complete carrier values without a matching paid first-year transaction are
  // useful to the agent as a projection, but never advance a rank.
  return syncSources(
    [
      {
        surface: 'POLICY_DETAIL',
        policyNumber,
        producerAgentId: input.agentId,
        carrierStatus: null,
        targetPremium: detailMoney(detail.ctp),
        anticipatedAnnualPremium: detailMoney(detail.anticipatedAnnualPremium),
        fetchedAt: detail.observedAt,
        raw: {
          deploymentScope: input.deploymentScope,
          policyDetailObservedAt: detail.observedAt.toISOString(),
          targetPremiumSource: 'POLICY_DETAIL_CTP',
          anticipatedAnnualPremiumSource: 'POLICY_DETAIL_AAP',
        },
      },
    ],
    database,
  )
}

function failedPromotionSyncResult(examined: number): PromotionCreditSyncResult {
  return {
    status: 'NEEDS_REVIEW',
    examined,
    eligible: 0,
    inserted: 0,
    skipped: examined > 0 ? { PROMOTION_WRITER_FAILED: examined } : {},
  }
}

/**
 * Promotion credits enrich the carrier snapshot; they are not the source of
 * truth for the snapshot itself. This boundary deliberately converts any
 * ledger/schema/achievement failure into a review result after snapshot
 * persistence has succeeded.
 */
export async function syncConfirmedCasePromotionCreditsSafely(
  input: Parameters<typeof syncConfirmedCasePromotionCredits>[0],
  database?: PromotionDatabase,
): Promise<PromotionCreditSyncResult> {
  try {
    return await syncConfirmedCasePromotionCredits(input, database)
  } catch {
    return failedPromotionSyncResult(input.snapshots.length)
  }
}

export async function syncConfirmedInforcePromotionCreditsSafely(
  input: Parameters<typeof syncConfirmedInforcePromotionCredits>[0],
  database?: PromotionDatabase,
): Promise<PromotionCreditSyncResult> {
  try {
    return await syncConfirmedInforcePromotionCredits(input, database)
  } catch {
    return failedPromotionSyncResult(input.snapshots.length)
  }
}

export async function syncNationalLifeCommissionPromotionCreditsSafely(
  input: Parameters<typeof syncNationalLifeCommissionPromotionCredits>[0],
  database?: PromotionDatabase,
): Promise<PromotionCreditSyncResult> {
  try {
    return await syncNationalLifeCommissionPromotionCredits(input, database)
  } catch {
    return failedPromotionSyncResult(input.rows.length)
  }
}

export async function syncPolicyDetailPromotionCreditsSafely(
  input: Parameters<typeof syncPolicyDetailPromotionCredits>[0],
  database: PromotionDatabase = prisma,
): Promise<PromotionCreditSyncResult> {
  try {
    return await syncPolicyDetailPromotionCredits(input, database)
  } catch {
    return failedPromotionSyncResult(1)
  }
}

function mergePromotionSyncResults(
  examined: number,
  results: readonly PromotionCreditSyncResult[],
): PromotionCreditSyncResult {
  const skipped: PromotionCreditSyncResult['skipped'] = {}
  for (const result of results) {
    for (const [reason, count] of Object.entries(result.skipped)) {
      if (!count) continue
      const key = reason as NationalLifePromotionSkipReason
      skipped[key] = (skipped[key] ?? 0) + count
    }
  }
  return {
    status: results.some((result) => result.status === 'NEEDS_REVIEW')
      ? 'NEEDS_REVIEW'
      : 'SYNCED',
    examined,
    eligible: results.reduce((total, result) => total + result.eligible, 0),
    inserted: results.reduce((total, result) => total + result.inserted, 0),
    skipped,
  }
}

async function syncStoredNationalLifePromotionCreditsForAgent(
  input: { agentId: string; deploymentScope: string; fetchedAt?: Date },
  database: PromotionDatabase,
): Promise<PromotionCreditSyncResult> {
  const detailRepository = database.nationalLifePolicyDetailSnapshot
  if (!detailRepository) throw new Error('Policy detail promotion source unavailable')

  const details = (await detailRepository.findMany({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
    },
    select: {
      policyNumber: true,
      ctp: true,
      anticipatedAnnualPremium: true,
      observedAt: true,
    },
  })) as PolicyDetailFacts[]
  if (details.length === 0) {
    return { status: 'SYNCED', examined: 0, eligible: 0, inserted: 0, skipped: {} }
  }

  const reportRows = input.deploymentScope === LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
    ? database.nationalLifePublishedReportRow
      ? await database.nationalLifePublishedReportRow.findMany({
          where: {
            agentId: input.agentId,
            deploymentScope: input.deploymentScope,
            gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
          },
          select: { raw: true },
        })
      : []
    : database.nationalLifeReportRow
      ? await database.nationalLifeReportRow.findMany({
        where: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
        },
        select: { raw: true },
      })
      : []
  const detailPolicies = new Set(
    details.map((detail) => canonicalPolicyNumber(detail.policyNumber)),
  )
  const evidence = reportRows.flatMap((row) => {
    const parsed = toNationalLifePromotionPaymentEvidence(row)
    return parsed && detailPolicies.has(parsed.policyNumber) ? [parsed] : []
  })
  const producerNpn = await getActiveProducerNpn(input.agentId, database)
  const ownedEvidence = producerNpn === undefined
    ? evidence
    : producerNpn
    ? evidence.filter(
        (item) => canonicalCarrierAgentNumber(item.writingAgentNumber) === producerNpn,
      )
    : []
  const paidPolicies = new Set(ownedEvidence.map((item) => item.policyNumber))
  const fetchedAt = input.fetchedAt ?? new Date()
  const results: PromotionCreditSyncResult[] = []

  if (evidence.length > 0) {
    results.push(
      await syncPaymentEvidence(
        {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          evidence,
          fetchedAt,
        },
        database,
      ),
    )
  }

  const pendingSources: PromotionSource[] = details.flatMap((detail) => {
    const policyNumber = canonicalPolicyNumber(detail.policyNumber)
    if (paidPolicies.has(policyNumber)) return []
    return [
      {
        surface: 'POLICY_DETAIL',
        policyNumber,
        producerAgentId: input.agentId,
        carrierStatus: null,
        targetPremium: detailMoney(detail.ctp),
        anticipatedAnnualPremium: detailMoney(detail.anticipatedAnnualPremium),
        fetchedAt: detail.observedAt,
        raw: {
          deploymentScope: input.deploymentScope,
          policyDetailObservedAt: detail.observedAt.toISOString(),
          targetPremiumSource: 'POLICY_DETAIL_CTP',
          anticipatedAnnualPremiumSource: 'POLICY_DETAIL_AAP',
        },
      },
    ]
  })
  if (pendingSources.length > 0) {
    results.push(
      producerNpn === null
        ? {
            status: 'SYNCED',
            examined: pendingSources.length,
            eligible: 0,
            inserted: 0,
            skipped: { PRODUCER_IDENTITY_MISMATCH: pendingSources.length },
          }
        : await syncSources(pendingSources, database),
    )
  }

  return mergePromotionSyncResults(details.length, results)
}

/** Replays already-extracted carrier facts after a complete sync or migration. */
export async function syncStoredNationalLifePromotionCreditsForAgentSafely(
  input: Parameters<typeof syncStoredNationalLifePromotionCreditsForAgent>[0],
  database: PromotionDatabase = prisma,
): Promise<PromotionCreditSyncResult> {
  try {
    return await syncStoredNationalLifePromotionCreditsForAgent(input, database)
  } catch {
    return failedPromotionSyncResult(1)
  }
}
