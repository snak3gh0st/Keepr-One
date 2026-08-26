const NLG_ORIGIN = 'https://www.nationallife.com'
const AUTH0_ORIGIN = 'https://nlg-prod.auth0.com'

export const FORESIGHT_APPROVED_RELEASES = ['5.3.65.31', '26.0.1'] as const
export const FORESIGHT_FLEXLIFE_INCLUDED_RIDERS = [
  'DeathBenefitProtection',
  'ABRTerminalIllness',
  'ABRChronicIllness',
  'ABRCriticalIllness',
  'ABRCriticalInjury',
  'ABRAlzheimersDisease',
] as const

export type ForesightLandingState =
  | 'FORESIGHT'
  | 'AUTH_REQUIRED'
  | 'MFA_REQUIRED'
  | 'UNEXPECTED_ORIGIN'
  | 'UNEXPECTED_PATH'

export type ForesightIllustrationSnapshotV1 = {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isIdentifier(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max &&
    /^[A-Za-z0-9._:-]+$/.test(value)
}

function isSafeName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 &&
    value.length <= 80 && !/[<>\u0000-\u001f\u007f]/.test(value)
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}

function parseAllocations(value: unknown): ForesightIllustrationSnapshotV1['allocations'] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null
  const allocations: ForesightIllustrationSnapshotV1['allocations'] = []
  for (const entry of value) {
    if (!isObject(entry) || !hasExactKeys(entry, ['strategy', 'percentage']) ||
      !isIdentifier(entry.strategy, 100) || typeof entry.percentage !== 'number' ||
      !Number.isInteger(entry.percentage) || entry.percentage < 1 || entry.percentage > 100) return null
    allocations.push({ strategy: entry.strategy, percentage: entry.percentage })
  }
  return allocations.reduce((sum, entry) => sum + entry.percentage, 0) === 100 ? allocations : null
}

function parseIdentifierList(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems ||
    !value.every((entry) => isIdentifier(entry, 100))) return null
  const unique = [...new Set(value)]
  return unique.length === value.length ? unique : null
}

export function parseForesightIllustrationSnapshot(
  value: unknown,
): ForesightIllustrationSnapshotV1 | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'schemaVersion', 'illustrationId', 'caseId', 'carrierCaseName', 'insured',
    'product', 'solve', 'faceAmount', 'premium', 'underwriting', 'deathBenefitOption', 'allocations',
    'riders', 'reports',
  ])) return null
  if (value.schemaVersion !== 1 || !isIdentifier(value.illustrationId) ||
    (value.caseId !== null && !isIdentifier(value.caseId)) || typeof value.carrierCaseName !== 'string' ||
    !/^[A-Z0-9][A-Z0-9_-]{5,79}$/.test(value.carrierCaseName)) return null

  const insured = value.insured
  if (!isObject(insured) || !hasExactKeys(insured, [
    'firstName', 'lastName', 'dateOfBirth', 'issueState',
  ]) || !isSafeName(insured.firstName) || !isSafeName(insured.lastName) ||
    !isIsoDate(insured.dateOfBirth) || typeof insured.issueState !== 'string' ||
    !/^[A-Z]{2}$/.test(insured.issueState)) return null

  const product = value.product
  if (!isObject(product) || !hasExactKeys(product, ['name', 'code']) ||
    product.name !== 'FlexLife' || product.code !== '956') return null

  const solve = value.solve
  if (!isObject(solve) || !hasExactKeys(solve, ['method', 'amount']) ||
    solve.method !== 'Specify_Amount' ||
    typeof solve.amount !== 'number' || !Number.isFinite(solve.amount) ||
    solve.amount <= 0 || solve.amount > 1_000_000_000) return null
  if (typeof value.faceAmount !== 'number' || !Number.isFinite(value.faceAmount) ||
    value.faceAmount <= 0 || value.faceAmount > 1_000_000_000 ||
    !isObject(value.premium) || !hasExactKeys(value.premium, ['mode', 'amount']) ||
    value.premium.mode !== 'Monthly' || typeof value.premium.amount !== 'number' ||
    !Number.isFinite(value.premium.amount) || value.premium.amount <= 0 ||
    value.premium.amount > 100_000_000) return null

  const underwriting = value.underwriting
  if (!isObject(underwriting) || !hasExactKeys(underwriting, ['gender', 'rateClass']) ||
    !['Male', 'Female'].includes(String(underwriting.gender)) ||
    !['Standard_NT', 'Standard_Tobacco'].includes(String(underwriting.rateClass))) return null
  if (!['A_Level', 'B_Increasing'].includes(String(value.deathBenefitOption))) return null

  const allocations = parseAllocations(value.allocations)
  const riders = parseIdentifierList(value.riders, 20)
  const reports = parseIdentifierList(value.reports, 10)
  if (!allocations || !riders || !reports || reports.length === 0 ||
    allocations.length !== 1 ||
    allocations[0]?.strategy !== 'SP500PointToPointCapFocus' ||
    allocations[0]?.percentage !== 100 ||
    JSON.stringify(riders) !== JSON.stringify(FORESIGHT_FLEXLIFE_INCLUDED_RIDERS) ||
    reports.length !== 1 || reports[0] !== 'NAIC_ILLUSTRATION') return null

  return {
    schemaVersion: 1,
    illustrationId: value.illustrationId,
    caseId: value.caseId,
    carrierCaseName: value.carrierCaseName,
    insured: {
      firstName: insured.firstName,
      lastName: insured.lastName,
      dateOfBirth: insured.dateOfBirth,
      issueState: insured.issueState,
    },
    product: { name: 'FlexLife', code: '956' },
    solve: {
      method: solve.method as ForesightIllustrationSnapshotV1['solve']['method'],
      amount: solve.amount,
    },
    faceAmount: value.faceAmount,
    premium: { mode: 'Monthly', amount: value.premium.amount },
    underwriting: {
      gender: underwriting.gender as ForesightIllustrationSnapshotV1['underwriting']['gender'],
      rateClass: underwriting.rateClass as ForesightIllustrationSnapshotV1['underwriting']['rateClass'],
    },
    deathBenefitOption: value.deathBenefitOption as ForesightIllustrationSnapshotV1['deathBenefitOption'],
    allocations,
    riders,
    reports,
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

export function canonicalForesightSnapshot(value: unknown): string {
  const snapshot = parseForesightIllustrationSnapshot(value)
  if (!snapshot) throw new Error('INVALID_FORESIGHT_SNAPSHOT')
  return canonicalize(snapshot)
}

export async function sha256ForesightSnapshot(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalForesightSnapshot(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function classifyForesightLocation(value: string): ForesightLandingState {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'UNEXPECTED_ORIGIN'
  }
  const path = url.pathname.toLowerCase()
  if (url.origin === AUTH0_ORIGIN) {
    return path.includes('/mfa') || path.includes('/challenge') ? 'MFA_REQUIRED' : 'AUTH_REQUIRED'
  }
  if (url.origin !== NLG_ORIGIN) return 'UNEXPECTED_ORIGIN'
  if (path.includes('/unsecure/') || path.includes('/login') || path.includes('/challenge')) {
    return path.includes('/mfa') || path.includes('/challenge') ? 'MFA_REQUIRED' : 'AUTH_REQUIRED'
  }
  return path.startsWith('/nwi/main/') ? 'FORESIGHT' : 'UNEXPECTED_PATH'
}

export function parseForesightRelease(input: {
  visibleText: string
  scriptUrls: readonly string[]
}): (typeof FORESIGHT_APPROVED_RELEASES)[number] | null {
  const candidates = new Set<string>()
  for (const match of input.visibleText.matchAll(/(?:release\s*)?v?(\d+\.\d+\.\d+(?:\.\d+)?)/gi)) {
    if (match[1]) candidates.add(match[1])
  }
  for (const source of input.scriptUrls) {
    const match = /ForeSight\.Release(?:\.Controls)?-(\d+\.\d+\.\d+(?:\.\d+)?)\.js/i.exec(source)
    if (match?.[1]) candidates.add(match[1])
  }
  return FORESIGHT_APPROVED_RELEASES.find((release) => candidates.has(release)) ?? null
}
