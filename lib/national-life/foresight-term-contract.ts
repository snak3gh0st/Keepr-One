import { createHash } from 'node:crypto'

const TERM_CARRIER_PRODUCTS = ['LSW Term', 'NL Term'] as const
const TERM_DURATIONS = ['10-G', '15-G', '20-G', '30-G', 'ART'] as const

export type ForesightTermIllustrationSnapshotV1 = {
  schemaVersion: 1
  illustrationId: string
  caseId: string | null
  carrierCaseName: string
  product: { carrierName: (typeof TERM_CARRIER_PRODUCTS)[number]; kind: 'TERM' }
  insured: {
    firstName: string
    lastName: string
    dateOfBirth: string
    issueState: string
  }
  underwriting: {
    gender: 'Male' | 'Female'
    rateClass: 'Standard_NT' | 'Standard_Tobacco'
  }
  faceAmount: number
  premiumMode: 'Monthly'
  termDuration: (typeof TERM_DURATIONS)[number]
  reports: ['NAIC_ILLUSTRATION']
}

type IllustrationSource = {
  id: string
  caseId: string | null
  createdAt: Date
  productName: string | null
  rawPayload: unknown
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 80 &&
    !/[<>\u0000-\u001f\u007f]/.test(value)
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function product(value: unknown): value is (typeof TERM_CARRIER_PRODUCTS)[number] {
  return typeof value === 'string' && (TERM_CARRIER_PRODUCTS as readonly string[]).includes(value)
}

function duration(value: unknown): value is (typeof TERM_DURATIONS)[number] {
  return typeof value === 'string' && (TERM_DURATIONS as readonly string[]).includes(value)
}

function caseName(source: IllustrationSource): string {
  const date = source.createdAt
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  const id = source.id.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 40)
  if (!id) throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  const dateStamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
  return `KEEPRONE-${dateStamp}-${id}`
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const input = value as Record<string, unknown>
  return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(input[key])}`).join(',')}}`
}

export function buildForesightTermIllustrationSnapshot(
  source: IllustrationSource,
): ForesightTermIllustrationSnapshotV1 {
  const payload = record(source.rawPayload)
  if (!Object.keys(payload).every((key) => ['foresightTermDraft', 'foresightTermResult'].includes(key)) ||
    !('foresightTermDraft' in payload)) throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  const draft = record(payload.foresightTermDraft)
  if (!exactKeys(draft, [
    'schemaVersion', 'carrierProduct', 'firstName', 'lastName', 'dateOfBirth', 'issueState',
    'gender', 'rateClass', 'faceAmount', 'premiumMode', 'termDuration',
  ]) || draft.schemaVersion !== 1 || !product(draft.carrierProduct) || source.productName !== draft.carrierProduct ||
    !safeName(draft.firstName) || !safeName(draft.lastName) || !isoDate(draft.dateOfBirth) ||
    typeof draft.issueState !== 'string' || !/^[A-Z]{2}$/.test(draft.issueState) ||
    !['Male', 'Female'].includes(String(draft.gender)) ||
    !['Standard_NT', 'Standard_Tobacco'].includes(String(draft.rateClass)) ||
    typeof draft.faceAmount !== 'number' || !Number.isFinite(draft.faceAmount) ||
    draft.faceAmount <= 0 || draft.faceAmount > 1_000_000_000 ||
    draft.premiumMode !== 'Monthly' || !duration(draft.termDuration)) {
    throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  }
  return {
    schemaVersion: 1,
    illustrationId: source.id,
    caseId: source.caseId,
    carrierCaseName: caseName(source),
    product: { carrierName: draft.carrierProduct, kind: 'TERM' },
    insured: {
      firstName: draft.firstName,
      lastName: draft.lastName,
      dateOfBirth: draft.dateOfBirth,
      issueState: draft.issueState,
    },
    underwriting: {
      gender: draft.gender as 'Male' | 'Female',
      rateClass: draft.rateClass as 'Standard_NT' | 'Standard_Tobacco',
    },
    faceAmount: draft.faceAmount,
    premiumMode: 'Monthly',
    termDuration: draft.termDuration,
    reports: ['NAIC_ILLUSTRATION'],
  }
}

export function foresightTermIllustrationInputHash(snapshot: ForesightTermIllustrationSnapshotV1): string {
  return createHash('sha256').update(canonicalize(snapshot)).digest('hex')
}

export type ForesightTermIllustrationReceipt = {
  inputHash: string
  caseFingerprint: string
  carrierCaseName: string
  carrierProduct: (typeof TERM_CARRIER_PRODUCTS)[number]
  requestedTermDuration?: (typeof TERM_DURATIONS)[number]
  confirmedTermDuration?: (typeof TERM_DURATIONS)[number]
  release: string
  reportCode: 'NAIC_ILLUSTRATION'
  documentSha256: string
  documentBytes: number
  saved: true
}

export function parseForesightTermIllustrationReceipt(value: unknown): ForesightTermIllustrationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  const legacyExpected = [
    'inputHash', 'caseFingerprint', 'carrierCaseName', 'carrierProduct', 'release', 'reportCode',
    'documentSha256', 'documentBytes', 'saved',
  ].sort()
  const expected = [...legacyExpected, 'requestedTermDuration', 'confirmedTermDuration'].sort()
  const keys = Object.keys(receipt).sort()
  const legacy = keys.length === legacyExpected.length &&
    keys.every((key, index) => key === legacyExpected[index])
  const current = keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  if ((!legacy && !current) ||
    typeof receipt.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.inputHash) ||
    typeof receipt.caseFingerprint !== 'string' || !/^case_[a-f0-9]{64}$/.test(receipt.caseFingerprint) ||
    typeof receipt.carrierCaseName !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(receipt.carrierCaseName) ||
    !product(receipt.carrierProduct) || (current && (!duration(receipt.requestedTermDuration) ||
    !duration(receipt.confirmedTermDuration))) || typeof receipt.release !== 'string' || receipt.release.length > 32 ||
    receipt.reportCode !== 'NAIC_ILLUSTRATION' || typeof receipt.documentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.documentSha256) || !Number.isSafeInteger(receipt.documentBytes) ||
    (receipt.documentBytes as number) < 5 || (receipt.documentBytes as number) > 25 * 1024 * 1024 ||
    receipt.saved !== true) return null
  return receipt as ForesightTermIllustrationReceipt
}

export function resolveForesightTermDurationResult(source: IllustrationSource): {
  requestedTermDuration: ForesightTermIllustrationSnapshotV1['termDuration']
  confirmedTermDuration: ForesightTermIllustrationSnapshotV1['termDuration']
  adjusted: boolean
} {
  const snapshot = buildForesightTermIllustrationSnapshot(source)
  const payload = record(source.rawPayload)
  const rawResult = payload.foresightTermResult
  if (!rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return {
      requestedTermDuration: snapshot.termDuration,
      confirmedTermDuration: snapshot.termDuration,
      adjusted: false,
    }
  }
  const result = rawResult as Record<string, unknown>
  const hasRequested = Object.hasOwn(result, 'requestedTermDuration')
  const hasConfirmed = Object.hasOwn(result, 'confirmedTermDuration')
  // Official Term results created before duration reconciliation remain valid.
  if (!hasRequested && !hasConfirmed) {
    return {
      requestedTermDuration: snapshot.termDuration,
      confirmedTermDuration: snapshot.termDuration,
      adjusted: false,
    }
  }
  if (!hasRequested || !hasConfirmed || result.source !== 'OFFICIAL_PDF' ||
    result.requestedTermDuration !== snapshot.termDuration || !duration(result.confirmedTermDuration)) {
    throw new Error('INVALID_FORESIGHT_TERM_INPUT')
  }
  return {
    requestedTermDuration: snapshot.termDuration,
    confirmedTermDuration: result.confirmedTermDuration,
    adjusted: result.confirmedTermDuration !== snapshot.termDuration,
  }
}
