import { createHash } from 'node:crypto'
import {
  DEATH_BENEFIT_OPTIONS,
  GENDERS,
  ISSUE_STATES,
  RAPID_SOLVE_ALLOCATION,
  RAPID_SOLVE_PREMIUM_MODE,
  RAPID_SOLVE_PRODUCT_CODE,
  RATE_CLASSES,
  SOLVE_TYPES,
  STRATEGIES,
  type RapidSolveRequest,
} from './rapid-solve'

export type FlexLifeQuoteSnapshotV1 = {
  schemaVersion: 1
  illustrationId: string
  request: RapidSolveRequest
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safeName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 &&
    value.length <= 80 && !/[<>\u0000-\u001f\u007f]/.test(value)
}

function validCarrierDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return false
  const [, month, day, year] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
}

export function parseFlexLifeQuoteSnapshot(value: unknown): FlexLifeQuoteSnapshotV1 | null {
  const snapshot = record(value)
  if (!snapshot || !hasExactKeys(snapshot, ['schemaVersion', 'illustrationId', 'request']) ||
    snapshot.schemaVersion !== 1 || typeof snapshot.illustrationId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(snapshot.illustrationId)) return null
  const request = record(snapshot.request)
  if (!request || !hasExactKeys(request, [
    'IssueState', 'FirstName', 'LastName', 'DateOfBirth', 'IssueAge', 'Gender', 'RateClass',
    'SolveType', 'Amount', 'DeathBenefitOption', 'Strategy', 'Allocation', 'ProductCode',
    'PremiumMode',
  ])) return null
  if (!(ISSUE_STATES as readonly unknown[]).includes(request.IssueState) ||
    !safeName(request.FirstName) || !safeName(request.LastName) || !validCarrierDate(request.DateOfBirth) ||
    !Number.isInteger(request.IssueAge) || (request.IssueAge as number) < 0 ||
    (request.IssueAge as number) > 120 || !(Object.values(GENDERS) as unknown[]).includes(request.Gender) ||
    !(Object.values(RATE_CLASSES) as unknown[]).includes(request.RateClass) ||
    !(Object.values(SOLVE_TYPES) as unknown[]).includes(request.SolveType) ||
    typeof request.Amount !== 'number' || !Number.isFinite(request.Amount) || request.Amount <= 0 ||
    request.Amount > 1_000_000_000 ||
    !(Object.values(DEATH_BENEFIT_OPTIONS) as unknown[]).includes(request.DeathBenefitOption) ||
    !(Object.values(STRATEGIES) as unknown[]).includes(request.Strategy) ||
    request.Allocation !== RAPID_SOLVE_ALLOCATION || request.ProductCode !== RAPID_SOLVE_PRODUCT_CODE ||
    request.PremiumMode !== RAPID_SOLVE_PREMIUM_MODE) return null
  return {
    schemaVersion: 1,
    illustrationId: snapshot.illustrationId,
    request: request as RapidSolveRequest,
  }
}

export function buildFlexLifeQuoteSnapshot(source: {
  id: string
  rawPayload: unknown
}): FlexLifeQuoteSnapshotV1 {
  const payload = record(source.rawPayload)
  const snapshot = parseFlexLifeQuoteSnapshot({
    schemaVersion: 1,
    illustrationId: source.id,
    request: payload?.request,
  })
  if (!snapshot) throw new Error('INVALID_FLEXLIFE_QUOTE_INPUT')
  return snapshot
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

export function canonicalFlexLifeQuoteSnapshot(value: unknown): string {
  const snapshot = parseFlexLifeQuoteSnapshot(value)
  if (!snapshot) throw new Error('INVALID_FLEXLIFE_QUOTE_INPUT')
  return canonicalize(snapshot)
}

export function flexLifeQuoteInputHash(value: unknown): string {
  return createHash('sha256').update(canonicalFlexLifeQuoteSnapshot(value)).digest('hex')
}
