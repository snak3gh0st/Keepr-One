import {
  parseForesightIllustrationSnapshot,
  type ForesightIllustrationSnapshotV1,
} from './foresight-contract'

export type ExecuteForesightIllustrationMessage = {
  type: 'EXECUTE_FORESIGHT_ILLUSTRATION'
  token: string
  correlationId: string
  inputHash: string
  snapshot: ForesightIllustrationSnapshotV1
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
    receipt: ForesightExecutionReceipt
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
  const snapshot = parseForesightIllustrationSnapshot(value.snapshot)
  return snapshot ? {
    type: 'EXECUTE_FORESIGHT_ILLUSTRATION',
    token: value.token,
    correlationId: value.correlationId,
    inputHash: value.inputHash,
    snapshot,
  } : null
}

export function parseForesightExecutionResponse(
  value: unknown,
  expected: Pick<ExecuteForesightIllustrationMessage, 'token' | 'correlationId' | 'inputHash'>,
): ForesightExecutionResponse {
  if (!isObject(value) || value.token !== expected.token || value.correlationId !== expected.correlationId) {
    throw new Error('FORESIGHT_RESPONSE_INVALID')
  }
  if (value.ok === false && value.type === 'FORESIGHT_ILLUSTRATION_FAILED' &&
    exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'code']) &&
    typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code)) {
    return value as ForesightExecutionResponse
  }
  if (value.ok !== true || value.type !== 'FORESIGHT_ILLUSTRATION_SAVED' ||
    !exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'receipt', 'document']) || !isObject(value.receipt) ||
    !exactKeys(value.receipt, [
      'inputHash', 'caseFingerprint', 'carrierCaseName', 'productCode', 'release', 'reportCode',
      'documentSha256', 'documentBytes', 'saved',
    ]) || value.receipt.inputHash !== expected.inputHash ||
    typeof value.receipt.caseFingerprint !== 'string' ||
    !/^case_[a-f0-9]{64}$/.test(value.receipt.caseFingerprint) ||
    typeof value.receipt.carrierCaseName !== 'string' ||
    !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(value.receipt.carrierCaseName) ||
    value.receipt.productCode !== '956' || typeof value.receipt.release !== 'string' ||
    value.receipt.release.length > 32 || value.receipt.reportCode !== 'NAIC_ILLUSTRATION' ||
    typeof value.receipt.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.receipt.documentSha256) ||
    typeof value.receipt.documentBytes !== 'number' || !Number.isSafeInteger(value.receipt.documentBytes) ||
    value.receipt.documentBytes < 5 || value.receipt.documentBytes > 25 * 1024 * 1024 ||
    value.receipt.saved !== true ||
    !isObject(value.document) || !exactKeys(value.document, ['contentType', 'pdfBase64']) ||
    value.document.contentType !== 'application/pdf' || typeof value.document.pdfBase64 !== 'string' ||
    value.document.pdfBase64.length < 8 || value.document.pdfBase64.length > 35_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.document.pdfBase64)) {
    throw new Error('FORESIGHT_RESPONSE_INVALID')
  }
  return value as ForesightExecutionResponse
}
