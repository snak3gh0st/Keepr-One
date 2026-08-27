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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function identifier(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value)
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

export function parseForesightTermIllustrationSnapshot(value: unknown): ForesightTermIllustrationSnapshotV1 | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'schemaVersion', 'illustrationId', 'caseId', 'carrierCaseName', 'product', 'insured', 'underwriting',
    'faceAmount', 'premiumMode', 'termDuration', 'reports',
  ]) || value.schemaVersion !== 1 || !identifier(value.illustrationId) ||
    (value.caseId !== null && !identifier(value.caseId)) || typeof value.carrierCaseName !== 'string' ||
    !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(value.carrierCaseName)) return null

  const product = value.product
  if (!isObject(product) || !hasExactKeys(product, ['carrierName', 'kind']) || product.kind !== 'TERM' ||
    !(TERM_CARRIER_PRODUCTS as readonly string[]).includes(String(product.carrierName))) return null

  const insured = value.insured
  if (!isObject(insured) || !hasExactKeys(insured, ['firstName', 'lastName', 'dateOfBirth', 'issueState']) ||
    !safeName(insured.firstName) || !safeName(insured.lastName) || !isoDate(insured.dateOfBirth) ||
    typeof insured.issueState !== 'string' || !/^[A-Z]{2}$/.test(insured.issueState)) return null

  const underwriting = value.underwriting
  if (!isObject(underwriting) || !hasExactKeys(underwriting, ['gender', 'rateClass']) ||
    !['Male', 'Female'].includes(String(underwriting.gender)) ||
    !['Standard_NT', 'Standard_Tobacco'].includes(String(underwriting.rateClass)) ||
    typeof value.faceAmount !== 'number' || !Number.isFinite(value.faceAmount) ||
    value.faceAmount <= 0 || value.faceAmount > 1_000_000_000 || value.premiumMode !== 'Monthly' ||
    !(TERM_DURATIONS as readonly string[]).includes(String(value.termDuration)) ||
    !Array.isArray(value.reports) || value.reports.length !== 1 || value.reports[0] !== 'NAIC_ILLUSTRATION') return null

  return {
    schemaVersion: 1,
    illustrationId: value.illustrationId,
    caseId: value.caseId,
    carrierCaseName: value.carrierCaseName,
    product: { carrierName: product.carrierName as ForesightTermIllustrationSnapshotV1['product']['carrierName'], kind: 'TERM' },
    insured: {
      firstName: insured.firstName,
      lastName: insured.lastName,
      dateOfBirth: insured.dateOfBirth,
      issueState: insured.issueState,
    },
    underwriting: {
      gender: underwriting.gender as ForesightTermIllustrationSnapshotV1['underwriting']['gender'],
      rateClass: underwriting.rateClass as ForesightTermIllustrationSnapshotV1['underwriting']['rateClass'],
    },
    faceAmount: value.faceAmount,
    premiumMode: 'Monthly',
    termDuration: value.termDuration as ForesightTermIllustrationSnapshotV1['termDuration'],
    reports: ['NAIC_ILLUSTRATION'],
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

export function canonicalForesightTermSnapshot(value: unknown): string {
  const snapshot = parseForesightTermIllustrationSnapshot(value)
  if (!snapshot) throw new Error('INVALID_FORESIGHT_TERM_SNAPSHOT')
  return canonicalize(snapshot)
}

export async function sha256ForesightTermSnapshot(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalForesightTermSnapshot(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
