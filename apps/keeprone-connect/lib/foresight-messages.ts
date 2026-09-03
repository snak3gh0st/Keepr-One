import {
  parseForesightIllustrationSnapshot,
  type ForesightIllustrationSnapshot,
} from './foresight-contract'
import {
  parseForesightTermIllustrationSnapshot,
  type ForesightTermIllustrationSnapshotV1,
} from './foresight-term-contract'

export type ForesightExecutionSnapshot = ForesightIllustrationSnapshot | ForesightTermIllustrationSnapshotV1

export type ExecuteForesightIllustrationMessage = {
  type: 'EXECUTE_FORESIGHT_ILLUSTRATION'
  token: string
  correlationId: string
  inputHash: string
  snapshot: ForesightExecutionSnapshot
}

export type ForesightExecutionReceipt = {
  inputHash: string
  caseFingerprint: string
  carrierCaseName: string
  productCode: '956'
  release: string
  reportCode: 'NAIC_ILLUSTRATION'
  documentSha256: string
  documentBytes: number
  saved: true
}

export type ForesightTermExecutionReceipt = {
  inputHash: string
  caseFingerprint: string
  carrierCaseName: string
  carrierProduct: 'LSW Term' | 'NL Term'
  requestedTermDuration: '10-G' | '15-G' | '20-G' | '30-G' | 'ART'
  confirmedTermDuration: '10-G' | '15-G' | '20-G' | '30-G' | 'ART'
  release: string
  reportCode: 'NAIC_ILLUSTRATION'
  documentSha256: string
  documentBytes: number
  saved: true
}

export type ForesightSolvedExecutionReceipt = {
  inputHash: string
  caseFingerprint: string
  carrierCaseName: string
  productCode: '956'
  solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
  faceAmount: number
  monthlyPremium: number
  annualPremium: number
  quickReview?: ForesightQuickReview
  release: string
  reportCode: 'NAIC_ILLUSTRATION'
  documentSha256: string
  documentBytes: number
  saved: true
}

export type ForesightQuickReview = {
  evidence?: {
    source: 'FORESIGHT_QUICK_VIEW'
    observedAt: string
    sourceRows: string[][]
  }
  summary: {
    initialFaceAmount: number
    lapseYear: number | null
    mecYear: number | null
    modalPremium: number
    minimumPremium: number | null
    deathBenefitProtectionPremium: number | null
    targetPremium: number
    mecPremium: number | null
    guidelineLevelPremium: number | null
    guidelineSinglePremium: number | null
  }
  annualProjection: Array<{
    policyYear: number
    age: number
    premiumOutlay: number | null
    weightedAverageInterestRate: number | null
    loan: number | null
    annualIncome: number | null
    accumulatedValue: number | null
    cashSurrenderValue: number | null
    netDeathBenefit: number | null
  }>
}

export type AnyForesightExecutionReceipt =
  | ForesightExecutionReceipt
  | ForesightSolvedExecutionReceipt
  | ForesightTermExecutionReceipt

export type ForesightExecutionDocument = {
  contentType: 'application/pdf'
  pdfBase64: string
}

export type ForesightExecutionResponse =
  | {
    ok: true
    type: 'FORESIGHT_ILLUSTRATION_SAVED'
    token: string
    correlationId: string
    receipt: AnyForesightExecutionReceipt
    document: ForesightExecutionDocument
  }
  | {
    ok: false
    type: 'FORESIGHT_ILLUSTRATION_FAILED'
    token: string
    correlationId: string
    code: string
  }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function boundedToken(value: unknown, min: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= 128
}

export function parseExecuteForesightIllustrationMessage(
  value: unknown,
): ExecuteForesightIllustrationMessage | null {
  if (!isObject(value) || !exactKeys(value, [
    'type', 'token', 'correlationId', 'inputHash', 'snapshot',
  ]) || value.type !== 'EXECUTE_FORESIGHT_ILLUSTRATION' ||
    !boundedToken(value.token, 32) || !boundedToken(value.correlationId, 16) ||
    typeof value.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputHash)) return null
  const snapshot = parseForesightIllustrationSnapshot(value.snapshot) ??
    parseForesightTermIllustrationSnapshot(value.snapshot)
  return snapshot ? {
    type: 'EXECUTE_FORESIGHT_ILLUSTRATION',
    token: value.token,
    correlationId: value.correlationId,
    inputHash: value.inputHash,
    snapshot,
  } : null
}

function commonReceiptFields(receipt: Record<string, unknown>, expectedHash: string): boolean {
  return receipt.inputHash === expectedHash && typeof receipt.caseFingerprint === 'string' &&
    /^case_[a-f0-9]{64}$/.test(receipt.caseFingerprint) && typeof receipt.carrierCaseName === 'string' &&
    /^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(receipt.carrierCaseName) && typeof receipt.release === 'string' &&
    receipt.release.length <= 32 && receipt.reportCode === 'NAIC_ILLUSTRATION' &&
    typeof receipt.documentSha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.documentSha256) &&
    typeof receipt.documentBytes === 'number' && Number.isSafeInteger(receipt.documentBytes) &&
    receipt.documentBytes >= 5 && receipt.documentBytes <= 25 * 1024 * 1024 && receipt.saved === true
}

function positiveCarrierAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000_000
}

function validReceipt(
  receipt: Record<string, unknown>,
  expected: { inputHash: string; snapshot: ForesightExecutionSnapshot },
): receipt is AnyForesightExecutionReceipt {
  if (!commonReceiptFields(receipt, expected.inputHash)) return false
  if ('code' in expected.snapshot.product) {
    if (expected.snapshot.schemaVersion === 2) {
      const keys = [
        'inputHash', 'caseFingerprint', 'carrierCaseName', 'productCode', 'solveBasis', 'faceAmount',
        'monthlyPremium', 'annualPremium', 'release', 'reportCode', 'documentSha256', 'documentBytes', 'saved',
      ]
      const allowedShape = exactKeys(receipt, keys) || exactKeys(receipt, [...keys, 'quickReview'])
      return allowedShape && receipt.productCode === '956' && receipt.solveBasis === expected.snapshot.solve.basis &&
        positiveCarrierAmount(receipt.faceAmount) && positiveCarrierAmount(receipt.monthlyPremium) &&
        positiveCarrierAmount(receipt.annualPremium) &&
        (!Object.hasOwn(receipt, 'quickReview') || isForesightQuickReview(receipt.quickReview))
    }
    return exactKeys(receipt, [
      'inputHash', 'caseFingerprint', 'carrierCaseName', 'productCode', 'release', 'reportCode',
      'documentSha256', 'documentBytes', 'saved',
    ]) && receipt.productCode === '956'
  }
  if (!('termDuration' in expected.snapshot)) return false
  const termDurations = ['10-G', '15-G', '20-G', '30-G', 'ART'] as const
  return exactKeys(receipt, [
    'inputHash', 'caseFingerprint', 'carrierCaseName', 'carrierProduct', 'requestedTermDuration',
    'confirmedTermDuration', 'release', 'reportCode', 'documentSha256', 'documentBytes', 'saved',
  ]) && receipt.carrierProduct === expected.snapshot.product.carrierName &&
    receipt.requestedTermDuration === expected.snapshot.termDuration &&
    (termDurations as readonly unknown[]).includes(receipt.confirmedTermDuration)
}

function nullableNonNegativeAmount(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000)
}

export function isForesightQuickReview(value: unknown): value is ForesightQuickReview {
  if (!isObject(value) ||
    (!exactKeys(value, ['summary', 'annualProjection']) &&
      !exactKeys(value, ['summary', 'annualProjection', 'evidence'])) ||
    !isObject(value.summary) || !Array.isArray(value.annualProjection) ||
    value.annualProjection.length < 1 || value.annualProjection.length > 121) return false
  if (Object.hasOwn(value, 'evidence')) {
    if (!isObject(value.evidence) || !exactKeys(value.evidence, ['source', 'observedAt', 'sourceRows']) ||
      value.evidence.source !== 'FORESIGHT_QUICK_VIEW' ||
      typeof value.evidence.observedAt !== 'string' ||
      Number.isNaN(Date.parse(value.evidence.observedAt)) ||
      !Array.isArray(value.evidence.sourceRows) || value.evidence.sourceRows.length < 2 ||
      value.evidence.sourceRows.length > 150 ||
      !value.evidence.sourceRows.every((row) => Array.isArray(row) && row.length <= 20 &&
        row.every((cell) => typeof cell === 'string' && cell.length <= 256))) return false
  }
  const summary = value.summary
  if (!exactKeys(summary, [
    'initialFaceAmount', 'lapseYear', 'mecYear', 'modalPremium', 'minimumPremium',
    'deathBenefitProtectionPremium', 'targetPremium', 'mecPremium',
    'guidelineLevelPremium', 'guidelineSinglePremium',
  ]) || !positiveCarrierAmount(summary.initialFaceAmount) ||
    !positiveCarrierAmount(summary.modalPremium) ||
    !positiveCarrierAmount(summary.targetPremium) ||
    !['lapseYear', 'mecYear', 'minimumPremium', 'deathBenefitProtectionPremium',
      'mecPremium', 'guidelineLevelPremium', 'guidelineSinglePremium']
      .every((key) => nullableNonNegativeAmount(summary[key]))) return false
  return value.annualProjection.every((row) => {
    if (!isObject(row) || !exactKeys(row, [
      'policyYear', 'age', 'premiumOutlay', 'weightedAverageInterestRate', 'loan',
      'annualIncome', 'accumulatedValue', 'cashSurrenderValue', 'netDeathBenefit',
    ]) || !Number.isInteger(row.policyYear) || (row.policyYear as number) < 1 ||
      (row.policyYear as number) > 121 || !Number.isInteger(row.age) ||
      (row.age as number) < 0 || (row.age as number) > 130) return false
    return ['premiumOutlay', 'weightedAverageInterestRate', 'loan', 'annualIncome',
      'accumulatedValue', 'cashSurrenderValue', 'netDeathBenefit']
      .every((key) => nullableNonNegativeAmount(row[key]))
  })
}

export function parseForesightExecutionResponse(
  value: unknown,
  expected: Pick<ExecuteForesightIllustrationMessage, 'token' | 'correlationId' | 'inputHash'> & { snapshot?: unknown },
): ForesightExecutionResponse {
  if (!isObject(value) || value.token !== expected.token || value.correlationId !== expected.correlationId) {
    throw new Error('FORESIGHT_RESPONSE_INVALID')
  }
  if (value.ok === false && value.type === 'FORESIGHT_ILLUSTRATION_FAILED' &&
    exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'code']) &&
    typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code)) {
    return value as ForesightExecutionResponse
  }
  const snapshot = parseForesightIllustrationSnapshot(expected.snapshot) ??
    parseForesightTermIllustrationSnapshot(expected.snapshot)
  if (value.ok !== true || value.type !== 'FORESIGHT_ILLUSTRATION_SAVED' || !snapshot ||
    !exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'receipt', 'document']) || !isObject(value.receipt) ||
    !validReceipt(value.receipt, { inputHash: expected.inputHash, snapshot }) ||
    !isObject(value.document) || !exactKeys(value.document, ['contentType', 'pdfBase64']) ||
    value.document.contentType !== 'application/pdf' || typeof value.document.pdfBase64 !== 'string' ||
    value.document.pdfBase64.length < 8 || value.document.pdfBase64.length > 35_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.document.pdfBase64)) {
    throw new Error('FORESIGHT_RESPONSE_INVALID')
  }
  return value as ForesightExecutionResponse
}
