import {
  sha256ForesightSnapshot,
  type ForesightIllustrationSnapshot,
  type ForesightIllustrationSnapshotV1,
} from './foresight-contract'

export const FORESIGHT_FLEXLIFE_FIELDS = {
  client: {
    jurisdiction: 'ctl00_mobilityPH_panelIllustration_cboJurisdiction',
    firstName: 'ctl00_mobilityPH_panelFirstInsured_ucInsured_txtFirstName',
    lastName: 'ctl00_mobilityPH_panelFirstInsured_ucInsured_txtLastName',
    gender: 'ctl00_mobilityPH_panelFirstInsured_ucInsured_cboGender',
    birthDate: 'ctl00_mobilityPH_panelFirstInsured_ucInsured_txtBirthDate',
    age: 'ctl00_mobilityPH_panelFirstInsured_ucInsured_txtAge',
    riskClass: 'ctl00_mobilityPH_panelFirstInsured_ucRisk_cboRiskClass',
    tableRating: 'ctl00_mobilityPH_panelFirstInsured_ucRisk_cboTableRating',
    flatExtra: 'ctl00_mobilityPH_panelFirstInsured_ucRisk_txtFlatExtra',
    pensionUnderwriting: 'ctl00_mobilityPH_panelFirstInsured_ucRisk_cboPensionUnderwriting',
    ownerType: 'ctl00_mobilityPH_panelOwner_ucOwner_cboOwnerType',
  },
  ledger: {
    deathBenefitType: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_schDeathBenefit_ctl02_cboDeathBenefitType',
    deathBenefitAmount: 'ctl00_mobilityPH_panelDBO_ucDeathBenefit_schDeathBenefit_ctl02_txtDeathBenefitAmount',
    deathBenefitOption: 'ctl00_mobilityPH_panelDBO_ucDeathBenefitOption_schDeathBenefitOption_ctl02_cboDeathBenefitOptionType',
    premiumMode: 'ctl00_mobilityPH_panelPremium_ucPremium_cboPremiumMode',
    premiumType: 'ctl00_mobilityPH_panelPremium_ucPremium_schPremium_ctl02_cboPremiumType',
    premiumAmount: 'ctl00_mobilityPH_panelPremium_ucPremium_schPremium_ctl02_txtPremiumAmount',
  },
} as const

const FORESIGHT_SOLVE_VALUES = {
  rdoDeathBenefitSolves: {
    None: '0',
    'Minimum DB/Max Cash Value': '101',
    'Balanced DB': '1004',
    'Based on Target Premium': '1001',
    'Protection Focus': '1005',
  },
  rdoPremiumSolves: {
    None: '0',
    'Protection Focus': '103',
    'Retirement Focus': '1001',
  },
} as const

export function foresightSolveValue(group: string, label: string): string | null {
  const values = FORESIGHT_SOLVE_VALUES[group as keyof typeof FORESIGHT_SOLVE_VALUES]
  return values?.[label as keyof typeof values] ?? null
}

export function foresightSolveLabel(group: string, value: string): string | null {
  const values = FORESIGHT_SOLVE_VALUES[group as keyof typeof FORESIGHT_SOLVE_VALUES]
  return Object.entries(values ?? {}).find(([, candidate]) => candidate === value)?.[0] ?? null
}

const FORESIGHT_SURFACES = {
  '/NWI/IUL2025/client.aspx': {
    surface: 'CLIENT' as const,
    required: Object.values(FORESIGHT_FLEXLIFE_FIELDS.client),
  },
  '/NWI/IUL2025/ledger.aspx': {
    surface: 'LEDGER' as const,
    required: Object.values(FORESIGHT_FLEXLIFE_FIELDS.ledger),
  },
} as const

export function validateForesightSurface(input: {
  path: string
  fieldIds: readonly string[]
}): { ok: true; surface: 'CLIENT' | 'LEDGER' } | {
  ok: false
  code: 'FORESIGHT_PATH_UNEXPECTED' | 'FORESIGHT_SCHEMA_MISMATCH'
} {
  const contract = FORESIGHT_SURFACES[input.path as keyof typeof FORESIGHT_SURFACES]
  if (!contract) return { ok: false, code: 'FORESIGHT_PATH_UNEXPECTED' }
  const found = new Set(input.fieldIds)
  return contract.required.every((id) => found.has(id))
    ? { ok: true, surface: contract.surface }
    : { ok: false, code: 'FORESIGHT_SCHEMA_MISMATCH' }
}

export type ForesightMaterialTarget = {
  carrierCaseName: string
  firstName: string
  lastName: string
  dateOfBirth: string
  issueState: string
  productCode: string
  solveMethod: string
  solveAmount: number
  faceAmount: number
  premiumMode: 'Monthly'
  premiumAmount: number
  gender: string
  rateClass: string
  deathBenefitOption: string
  allocations: Array<{ strategy: string; percentage: number }>
  riders: string[]
  reports: string[]
}

export type ForesightMaterialReadback = Omit<ForesightMaterialTarget, 'solveAmount' | 'faceAmount' | 'premiumAmount'> & {
  solveAmount: number | string
  faceAmount: number | string
  premiumAmount: number | string
}

export function foresightClientBirthDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${month}/${day}/${year}`
}

export function buildForesightTarget(
  snapshot: ForesightIllustrationSnapshotV1,
): ForesightMaterialTarget {
  return {
    carrierCaseName: snapshot.carrierCaseName,
    firstName: snapshot.insured.firstName,
    lastName: snapshot.insured.lastName,
    dateOfBirth: foresightClientBirthDate(snapshot.insured.dateOfBirth),
    issueState: snapshot.insured.issueState,
    productCode: snapshot.product.code,
    solveMethod: snapshot.solve.method,
    solveAmount: snapshot.solve.amount,
    faceAmount: snapshot.faceAmount,
    premiumMode: snapshot.premium.mode,
    premiumAmount: snapshot.premium.amount,
    gender: snapshot.underwriting.gender,
    rateClass: snapshot.underwriting.rateClass,
    deathBenefitOption: snapshot.deathBenefitOption,
    allocations: snapshot.allocations.map((entry) => ({ ...entry })),
    riders: [...snapshot.riders],
    reports: [...snapshot.reports],
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeAmount(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const stripped = value.replace(/[^0-9.-]/g, '')
  if (!/\d/.test(stripped)) return null
  const parsed = Number(stripped)
  return Number.isFinite(parsed) ? parsed : null
}

export function carrierAmountEquals(value: number | string, expected: number): boolean {
  return normalizeAmount(value) === expected
}

function normalizeCarrierDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match ? `${match[1]!.padStart(2, '0')}/${match[2]!.padStart(2, '0')}/${match[3]}` : value
}

function sameStructured(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function compareForesightTarget(
  snapshot: ForesightIllustrationSnapshotV1,
  observed: ForesightMaterialReadback,
): { ok: true } | { ok: false; mismatches: string[] } {
  const expected = buildForesightTarget(snapshot)
  const mismatches: string[] = []
  const strings = [
    'carrierCaseName', 'firstName', 'lastName', 'dateOfBirth', 'issueState',
    'productCode', 'solveMethod', 'premiumMode', 'gender', 'rateClass', 'deathBenefitOption',
  ] as const
  for (const key of strings) {
    const left = key === 'dateOfBirth' ? normalizeCarrierDate(observed[key]) : normalizeText(observed[key])
    const right = key === 'dateOfBirth' ? normalizeCarrierDate(expected[key]) : normalizeText(expected[key])
    if (left !== right) mismatches.push(key)
  }
  if (!carrierAmountEquals(observed.solveAmount, expected.solveAmount)) mismatches.push('solveAmount')
  if (!carrierAmountEquals(observed.faceAmount, expected.faceAmount)) mismatches.push('faceAmount')
  if (!carrierAmountEquals(observed.premiumAmount, expected.premiumAmount)) mismatches.push('premiumAmount')
  if (!sameStructured(observed.allocations, expected.allocations)) mismatches.push('allocations')
  if (!sameStructured(observed.riders, expected.riders)) mismatches.push('riders')
  if (!sameStructured(observed.reports, expected.reports)) mismatches.push('reports')
  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches }
}

/**
 * Error codes may travel through the extension and the connector event log.
 * Keep the diagnostic limited to the field name: that makes a carrier drift
 * actionable without ever placing the insured value in telemetry.
 */
export function foresightReadbackMismatchCode(mismatches: readonly string[]): string {
  const field = mismatches[0]
  if (!field) return 'FORESIGHT_READBACK_MISMATCH'
  const normalized = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
  const code = `FORESIGHT_READBACK_${normalized}_MISMATCH`
  return code.length <= 80 ? code : 'FORESIGHT_READBACK_MISMATCH'
}

export async function deterministicCaseFingerprint(
  snapshot: ForesightIllustrationSnapshot,
): Promise<string> {
  // Reuse the complete approved input hash: the receipt exposes only a digest,
  // never the insured values used to derive it.
  return `case_${await sha256ForesightSnapshot(snapshot)}`
}
