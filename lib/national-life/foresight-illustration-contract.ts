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
    method: 'Specify_Amount' | 'Based_on_Target_Premium' | 'Min_DB_Max_Cash_Value'
    amount: number
  }
  underwriting: {
    gender: 'Male' | 'Female'
    rateClass: 'Standard_NT' | 'Standard_Tobacco'
  }
  deathBenefitOption: 'A_Level' | 'B_Increasing'
  allocations: Array<{ strategy: string; percentage: number }>
  riders: string[]
  reports: string[]
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

export function buildForesightIllustrationSnapshot(
  source: IllustrationSnapshotSource,
): ForesightIllustrationExecutionSnapshot {
  if (!source.id || source.productName !== 'FlexLife') throw new Error('INVALID_FORESIGHT_INPUT')
  const payload = record(source.rawPayload)
  const request = record(payload.request)
  if (request.ProductCode !== '956' || request.Allocation !== 100) {
    throw new Error('INVALID_FORESIGHT_INPUT')
  }
  const issueState = text(request.IssueState, 2)
  if (!/^[A-Z]{2}$/.test(issueState)) throw new Error('INVALID_FORESIGHT_INPUT')
  const strategy = text(request.Strategy)

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
      method: oneOf(request.SolveType, [
        'Specify_Amount', 'Based_on_Target_Premium', 'Min_DB_Max_Cash_Value',
      ] as const),
      amount: positiveNumber(request.Amount),
    },
    underwriting: {
      gender: oneOf(request.Gender, ['Male', 'Female'] as const),
      rateClass: oneOf(request.RateClass, ['Standard_NT', 'Standard_Tobacco'] as const),
    },
    deathBenefitOption: oneOf(request.DeathBenefitOption, ['A_Level', 'B_Increasing'] as const),
    allocations: [{ strategy, percentage: 100 }],
    riders: [],
    reports: ['CLIENT_ILLUSTRATION'],
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
