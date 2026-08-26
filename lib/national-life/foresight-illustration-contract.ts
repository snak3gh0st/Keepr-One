import { createHash } from 'node:crypto'

export type ForesightIllustrationExecutionSnapshot = {
  schemaVersion: 1
  illustrationId: string
  caseId: string | null
  carrierCaseName: string
  insured: {
    firstName: string
    lastName: string
    dateOfBirth: string
    issueState: string
  }
  product: { name: 'FlexLife'; code: '956' }
  solve: {
    method: 'Specify_Amount'
    amount: number
  }
  faceAmount: number
  premium: { mode: 'Monthly'; amount: number }
  underwriting: {
    gender: 'Male' | 'Female'
    rateClass: 'Standard_NT' | 'Standard_Tobacco'
  }
  deathBenefitOption: 'A_Level' | 'B_Increasing'
  allocations: Array<{ strategy: string; percentage: number }>
  riders: string[]
  reports: string[]
}

export const FORESIGHT_FLEXLIFE_INCLUDED_RIDERS = [
  'DeathBenefitProtection',
  'ABRTerminalIllness',
  'ABRChronicIllness',
  'ABRCriticalIllness',
  'ABRCriticalInjury',
  'ABRAlzheimersDisease',
] as const

type IllustrationSnapshotSource = {
  id: string
  caseId: string | null
  createdAt: Date
  productName: string | null
  rawPayload: unknown
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, max = 100): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 1 ||
    value.length > max || /[<>\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  return value as T
}

function positiveNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  return value
}

function isoDateFromCarrier(value: unknown): string {
  if (typeof value !== 'string') throw new Error('INVALID_FORESIGHT_INPUT')
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) throw new Error('INVALID_FORESIGHT_INPUT')
  const [, month, day, year] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)) throw new Error('INVALID_FORESIGHT_INPUT')
  return `${year}-${month}-${day}`
}

function dateStamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('INVALID_FORESIGHT_INPUT')
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`
}

function carrierCaseName(source: IllustrationSnapshotSource): string {
  const id = source.id.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 40)
  if (!id) throw new Error('INVALID_FORESIGHT_INPUT')
  return `KEEPRONE-${dateStamp(source.createdAt)}-${id}`
}

export function buildForesightIllustrationSnapshot(
  source: IllustrationSnapshotSource,
): ForesightIllustrationExecutionSnapshot {
  if (!source.id || source.productName !== 'FlexLife') throw new Error('INVALID_FORESIGHT_INPUT')
  const payload = record(source.rawPayload)
  const request = record(payload.request)
  const response = record(payload.response)
  if (request.ProductCode !== '956' || request.Allocation !== 100) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  const issueState = text(request.IssueState, 2)
  if (!/^[A-Z]{2}$/.test(issueState)) throw new Error('INVALID_FORESIGHT_INPUT')
  const strategy = text(request.Strategy)
  const solveMethod = oneOf(request.SolveType, ['Specify_Amount'] as const)
  const solveAmount = positiveNumber(request.Amount)
  const faceAmount = positiveNumber(response.faceAmount)
  if (solveAmount !== faceAmount) throw new Error('INVALID_FORESIGHT_INPUT')

  return {
    schemaVersion: 1,
    illustrationId: source.id,
    caseId: source.caseId,
    carrierCaseName: carrierCaseName(source),
    insured: {
      firstName: text(request.FirstName, 80),
      lastName: text(request.LastName, 80),
      dateOfBirth: isoDateFromCarrier(request.DateOfBirth),
      issueState,
    },
    product: { name: 'FlexLife', code: '956' },
    solve: {
      method: solveMethod,
      amount: solveAmount,
    },
    faceAmount,
    premium: { mode: 'Monthly', amount: positiveNumber(response.monthlyPremium) },
    underwriting: {
      gender: oneOf(request.Gender, ['Male', 'Female'] as const),
      rateClass: oneOf(request.RateClass, ['Standard_NT', 'Standard_Tobacco'] as const),
    },
    deathBenefitOption: oneOf(request.DeathBenefitOption, ['A_Level', 'B_Increasing'] as const),
    allocations: [{ strategy, percentage: 100 }],
    riders: [...FORESIGHT_FLEXLIFE_INCLUDED_RIDERS],
    reports: ['NAIC_ILLUSTRATION'],
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

export function foresightIllustrationInputHash(
  snapshot: ForesightIllustrationExecutionSnapshot,
): string {
  return createHash('sha256').update(canonicalize(snapshot)).digest('hex')
}

export type ForesightIllustrationReceipt = {
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

export function parseForesightIllustrationReceipt(value: unknown): ForesightIllustrationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  const expected = [
    'inputHash', 'caseFingerprint', 'carrierCaseName', 'productCode', 'release', 'reportCode',
    'documentSha256', 'documentBytes', 'saved',
  ].sort()
  const keys = Object.keys(receipt).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
    typeof receipt.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.inputHash) ||
    typeof receipt.caseFingerprint !== 'string' || !/^case_[a-f0-9]{64}$/.test(receipt.caseFingerprint) ||
    typeof receipt.carrierCaseName !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(receipt.carrierCaseName) ||
    receipt.productCode !== '956' || typeof receipt.release !== 'string' || receipt.release.length > 32 ||
    receipt.reportCode !== 'NAIC_ILLUSTRATION' || typeof receipt.documentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.documentSha256) || !Number.isSafeInteger(receipt.documentBytes) ||
    (receipt.documentBytes as number) < 5 || (receipt.documentBytes as number) > 25 * 1024 * 1024 ||
    receipt.saved !== true) return null
  return receipt as ForesightIllustrationReceipt
}
