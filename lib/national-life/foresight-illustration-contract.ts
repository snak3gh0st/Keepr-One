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

export type ForesightSolvedIllustrationSnapshotV2 = {
  schemaVersion: 2
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
    basis: 'DEATH_BENEFIT' | 'PREMIUM'
    method: 'Protection_Focus' | 'Based_on_Target_Premium'
    amount: number
  }
  faceAmount: number | null
  premium: { mode: 'Monthly'; amount: number | null }
  underwriting: {
    gender: 'Male' | 'Female'
    rateClass: 'Standard_NT' | 'Standard_Tobacco'
  }
  deathBenefitOption: 'A_Level' | 'B_Increasing'
  allocations: Array<{ strategy: string; percentage: number }>
  riders: string[]
  reports: string[]
}

export type ForesightIllustrationSnapshot =
  | ForesightIllustrationExecutionSnapshot
  | ForesightSolvedIllustrationSnapshotV2

export const FORESIGHT_FLEXLIFE_INCLUDED_RIDERS = [
  'DeathBenefitProtection',
  'ABRTerminalIllness',
  'ABRChronicIllness',
  'ABRCriticalIllness',
  'ABRCriticalInjury',
  'ABRAlzheimersDisease',
] as const

// Foresight, rather than Rapid Solve, is the carrier surface that creates the
// official illustration. Keep its jurisdictions separate: Rapid Solve omits
// New York, while Foresight presents it as a valid jurisdiction choice.
export const FORESIGHT_ISSUE_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const

export type ForesightIllustrationDraftV1 = {
  schemaVersion: 1
  firstName: string
  lastName: string
  dateOfBirth: string
  issueState: string
  gender: 'Male' | 'Female'
  rateClass: 'Standard_NT' | 'Standard_Tobacco'
  faceAmount: number
  monthlyPremium: number
  deathBenefitOption: 'A_Level' | 'B_Increasing'
  strategy: 'SP500PointToPointCapFocus'
}

export type ForesightIllustrationDraftV2 = {
  schemaVersion: 2
  firstName: string
  lastName: string
  dateOfBirth: string
  issueState: string
  gender: 'Male' | 'Female'
  rateClass: 'Standard_NT' | 'Standard_Tobacco'
  solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
  targetFaceAmount?: number
  targetMonthlyPremium?: number
  deathBenefitOption: 'A_Level' | 'B_Increasing'
  strategy: 'SP500PointToPointCapFocus'
}

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

function parseForesightIllustrationDraft(value: unknown): ForesightIllustrationDraftV1 | null {
  try {
    const draft = record(value)
    if (Object.keys(draft).sort().join(',') !==
      'dateOfBirth,deathBenefitOption,faceAmount,firstName,gender,issueState,lastName,monthlyPremium,rateClass,schemaVersion,strategy' ||
      draft.schemaVersion !== 1 || !text(draft.firstName, 80) || !text(draft.lastName, 80) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(draft.dateOfBirth)) ||
      !isoDateFromCarrier(`${String(draft.dateOfBirth).slice(5, 7)}/${String(draft.dateOfBirth).slice(8, 10)}/${String(draft.dateOfBirth).slice(0, 4)}`) ||
      !FORESIGHT_ISSUE_STATES.includes(draft.issueState as typeof FORESIGHT_ISSUE_STATES[number]) ||
      !['Male', 'Female'].includes(String(draft.gender)) ||
      !['Standard_NT', 'Standard_Tobacco'].includes(String(draft.rateClass)) ||
      typeof draft.faceAmount !== 'number' || typeof draft.monthlyPremium !== 'number' ||
      !Number.isFinite(draft.faceAmount) || !Number.isFinite(draft.monthlyPremium) ||
      draft.faceAmount <= 0 || draft.faceAmount > 1_000_000_000 ||
      draft.monthlyPremium <= 0 || draft.monthlyPremium > 100_000_000 ||
      !['A_Level', 'B_Increasing'].includes(String(draft.deathBenefitOption)) ||
      draft.strategy !== 'SP500PointToPointCapFocus') return null
    return draft as ForesightIllustrationDraftV1
  } catch {
    return null
  }
}

function parseForesightIllustrationDraftV2(value: unknown): ForesightIllustrationDraftV2 | null {
  try {
    const draft = record(value)
    const common = [
      'schemaVersion', 'firstName', 'lastName', 'dateOfBirth', 'issueState', 'gender', 'rateClass',
      'solveBasis', 'deathBenefitOption', 'strategy',
    ]
    const amountKey = draft.solveBasis === 'DEATH_BENEFIT' ? 'targetFaceAmount'
      : draft.solveBasis === 'PREMIUM' ? 'targetMonthlyPremium' : null
    if (!amountKey || Object.keys(draft).sort().join(',') !== [...common, amountKey].sort().join(',') ||
      draft.schemaVersion !== 2 || !text(draft.firstName, 80) || !text(draft.lastName, 80) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(draft.dateOfBirth)) ||
      !isoDateFromCarrier(`${String(draft.dateOfBirth).slice(5, 7)}/${String(draft.dateOfBirth).slice(8, 10)}/${String(draft.dateOfBirth).slice(0, 4)}`) ||
      !FORESIGHT_ISSUE_STATES.includes(draft.issueState as typeof FORESIGHT_ISSUE_STATES[number]) ||
      !['Male', 'Female'].includes(String(draft.gender)) ||
      !['Standard_NT', 'Standard_Tobacco'].includes(String(draft.rateClass)) ||
      !['DEATH_BENEFIT', 'PREMIUM'].includes(String(draft.solveBasis)) ||
      !['A_Level', 'B_Increasing'].includes(String(draft.deathBenefitOption)) ||
      draft.strategy !== 'SP500PointToPointCapFocus' ||
      !positiveNumber(draft[amountKey])) return null
    return draft as ForesightIllustrationDraftV2
  } catch {
    return null
  }
}

function snapshotFromForesightDraft(
  source: IllustrationSnapshotSource,
  draft: ForesightIllustrationDraftV1,
): ForesightIllustrationExecutionSnapshot {
  return {
    schemaVersion: 1,
    illustrationId: source.id,
    caseId: source.caseId,
    carrierCaseName: carrierCaseName(source),
    insured: {
      firstName: draft.firstName,
      lastName: draft.lastName,
      dateOfBirth: draft.dateOfBirth,
      issueState: draft.issueState,
    },
    product: { name: 'FlexLife', code: '956' },
    solve: { method: 'Specify_Amount', amount: draft.faceAmount },
    faceAmount: draft.faceAmount,
    premium: { mode: 'Monthly', amount: draft.monthlyPremium },
    underwriting: { gender: draft.gender, rateClass: draft.rateClass },
    deathBenefitOption: draft.deathBenefitOption,
    allocations: [{ strategy: draft.strategy, percentage: 100 }],
    riders: [...FORESIGHT_FLEXLIFE_INCLUDED_RIDERS],
    reports: ['NAIC_ILLUSTRATION'],
  }
}

function snapshotFromForesightDraftV2(
  source: IllustrationSnapshotSource,
  draft: ForesightIllustrationDraftV2,
): ForesightSolvedIllustrationSnapshotV2 {
  const isFaceSolve = draft.solveBasis === 'DEATH_BENEFIT'
  const amount = isFaceSolve ? positiveNumber(draft.targetFaceAmount) : positiveNumber(draft.targetMonthlyPremium)
  return {
    schemaVersion: 2,
    illustrationId: source.id,
    caseId: source.caseId,
    carrierCaseName: carrierCaseName(source),
    insured: {
      firstName: draft.firstName,
      lastName: draft.lastName,
      dateOfBirth: draft.dateOfBirth,
      issueState: draft.issueState,
    },
    product: { name: 'FlexLife', code: '956' },
    solve: isFaceSolve
      ? { basis: 'DEATH_BENEFIT', method: 'Protection_Focus', amount }
      : { basis: 'PREMIUM', method: 'Based_on_Target_Premium', amount },
    faceAmount: isFaceSolve ? amount : null,
    premium: { mode: 'Monthly', amount: isFaceSolve ? null : amount },
    underwriting: { gender: draft.gender, rateClass: draft.rateClass },
    deathBenefitOption: draft.deathBenefitOption,
    allocations: [{ strategy: draft.strategy, percentage: 100 }],
    riders: [...FORESIGHT_FLEXLIFE_INCLUDED_RIDERS],
    reports: ['NAIC_ILLUSTRATION'],
  }
}

export function buildForesightIllustrationSnapshot(
  source: IllustrationSnapshotSource,
): ForesightIllustrationSnapshot {
  if (!source.id || source.productName !== 'FlexLife') throw new Error('INVALID_FORESIGHT_INPUT')
  const payload = record(source.rawPayload)
  const solvedDraft = parseForesightIllustrationDraftV2(payload.foresightDraft)
  if (solvedDraft) return snapshotFromForesightDraftV2(source, solvedDraft)
  const directDraft = parseForesightIllustrationDraft(payload.foresightDraft)
  if (directDraft) return snapshotFromForesightDraft(source, directDraft)
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
  snapshot: ForesightIllustrationSnapshot,
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

export type ForesightSolvedIllustrationReceipt = {
  inputHash: string
  caseFingerprint: string
  carrierCaseName: string
  productCode: '956'
  solveBasis: 'DEATH_BENEFIT' | 'PREMIUM'
  faceAmount: number
  monthlyPremium: number
  annualPremium: number
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

export function parseForesightSolvedIllustrationReceipt(value: unknown): ForesightSolvedIllustrationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const receipt = value as Record<string, unknown>
  const expected = [
    'inputHash', 'caseFingerprint', 'carrierCaseName', 'productCode', 'solveBasis', 'faceAmount',
    'monthlyPremium', 'annualPremium', 'release', 'reportCode', 'documentSha256', 'documentBytes', 'saved',
  ].sort()
  const keys = Object.keys(receipt).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
    typeof receipt.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.inputHash) ||
    typeof receipt.caseFingerprint !== 'string' || !/^case_[a-f0-9]{64}$/.test(receipt.caseFingerprint) ||
    typeof receipt.carrierCaseName !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(receipt.carrierCaseName) ||
    receipt.productCode !== '956' || !['DEATH_BENEFIT', 'PREMIUM'].includes(String(receipt.solveBasis)) ||
    typeof receipt.faceAmount !== 'number' || !Number.isFinite(receipt.faceAmount) || receipt.faceAmount <= 0 ||
    receipt.faceAmount > 1_000_000_000 || typeof receipt.monthlyPremium !== 'number' ||
    !Number.isFinite(receipt.monthlyPremium) || receipt.monthlyPremium <= 0 ||
    receipt.monthlyPremium > 100_000_000 || typeof receipt.annualPremium !== 'number' ||
    !Number.isFinite(receipt.annualPremium) || receipt.annualPremium <= 0 ||
    receipt.annualPremium > 1_000_000_000 || typeof receipt.release !== 'string' || receipt.release.length > 32 ||
    receipt.reportCode !== 'NAIC_ILLUSTRATION' || typeof receipt.documentSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.documentSha256) || !Number.isSafeInteger(receipt.documentBytes) ||
    (receipt.documentBytes as number) < 5 || (receipt.documentBytes as number) > 25 * 1024 * 1024 ||
    receipt.saved !== true) return null
  return receipt as ForesightSolvedIllustrationReceipt
}
