const POLICY_DETAIL_PATH =
  /^\/agent\/book-of-business\/inforce-book\/all-clients\/policy-details\?id=[a-f0-9]{32}$/

const EMPTY_VALUES = new Set(['', '—', '-', 'N/A', 'n/a', 'Not available'])

export type NationalLifePolicyDetailSection = 'COVERAGE' | 'PAYMENTS'

export type NationalLifePolicyDetailField = {
  section: NationalLifePolicyDetailSection
  label: string
  value: string
}

export type NationalLifePolicyDetail = {
  policyNumber: string
  sourcePath: string
  observedAt: Date
  coverageCaptured: boolean
  paymentsCaptured: boolean
  totalFaceAmount: string | null
  netDeathBenefit: string | null
  nextScheduledPaymentDate: Date | null
  paymentFrequency: string | null
  plannedPeriodicPayment: string | null
  anticipatedAnnualPremium: string | null
  minimumMonthlyPremium: string | null
  minimumGuaranteedPremium: string | null
  ctp: string | null
  mecLimit: string | null
  mecLimitThrough: Date | null
  guidelinePremiumLimit: string | null
  guidelinePremiumLimitThrough: Date | null
}

export type NationalLifePolicyDetailObservation = {
  navigatePath: string
  expectedPolicyNumber: string
  visiblePolicyNumber: string
  observedAt: string
  fields: NationalLifePolicyDetailField[]
}

function normalizePolicyNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function isEmpty(value: string): boolean {
  return EMPTY_VALUES.has(value.trim())
}

function money(value: string | undefined): string | null {
  if (value === undefined || isEmpty(value)) return null
  const trimmed = value.trim()
  const parenthesized = /^\((.*)\)$/.exec(trimmed)
  const unsigned = (parenthesized?.[1] ?? trimmed).replace(/^\$\s*/, '')
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(unsigned)) {
    throw new Error('POLICY_DETAIL_VALUE_INVALID')
  }
  const normalized = unsigned.replace(/,/g, '')
  const [whole, fraction = ''] = normalized.split('.')
  const result = `${whole}.${fraction.padEnd(2, '0')}`
  return parenthesized ? `-${result}` : result
}

function carrierDate(value: string | undefined): Date | null {
  if (value === undefined || isEmpty(value)) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) throw new Error('POLICY_DETAIL_VALUE_INVALID')
  const [, month, day, year] = match
  const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    result.getUTCFullYear() !== Number(year) ||
    result.getUTCMonth() !== Number(month) - 1 ||
    result.getUTCDate() !== Number(day)
  ) {
    throw new Error('POLICY_DETAIL_VALUE_INVALID')
  }
  return result
}

function limit(value: string | undefined): { amount: string | null; through: Date | null } {
  if (value === undefined || isEmpty(value)) return { amount: null, through: null }
  const match = /^(.*?)\s+through\s+(\d{2}\/\d{2}\/\d{4})$/i.exec(value.trim())
  if (!match) throw new Error('POLICY_DETAIL_VALUE_INVALID')
  return { amount: money(match[1]), through: carrierDate(match[2]) }
}

function boundedText(value: string | undefined): string | null {
  if (value === undefined || isEmpty(value)) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length > 64) throw new Error('POLICY_DETAIL_VALUE_INVALID')
  return normalized
}

function fieldMap(fields: readonly NationalLifePolicyDetailField[]): Map<string, string> {
  if (fields.length > 64) throw new Error('POLICY_DETAIL_VALUE_INVALID')
  const values = new Map<string, string>()
  for (const field of fields) {
    const key = `${field.section}:${field.label.replace(/\s+/g, ' ').trim()}`
    const normalized = field.value.replace(/\s+/g, ' ').trim()
    const existing = values.get(key)
    if (existing !== undefined && existing !== normalized) {
      throw new Error('POLICY_DETAIL_VALUE_CONFLICT')
    }
    values.set(key, normalized)
  }
  return values
}

export function parseNationalLifePolicyDetail(
  input: NationalLifePolicyDetailObservation,
): NationalLifePolicyDetail {
  if (!POLICY_DETAIL_PATH.test(input.navigatePath)) {
    throw new Error('POLICY_DETAIL_PATH_INVALID')
  }
  const expectedPolicyNumber = normalizePolicyNumber(input.expectedPolicyNumber)
  const visiblePolicyNumber = normalizePolicyNumber(input.visiblePolicyNumber)
  if (!expectedPolicyNumber || expectedPolicyNumber !== visiblePolicyNumber) {
    throw new Error('POLICY_DETAIL_TARGET_MISMATCH')
  }
  const observedAt = new Date(input.observedAt)
  if (!Number.isFinite(observedAt.getTime())) throw new Error('POLICY_DETAIL_VALUE_INVALID')

  const fields = fieldMap(input.fields)
  const value = (section: NationalLifePolicyDetailSection, label: string) =>
    fields.get(`${section}:${label}`)
  const mec = limit(value('COVERAGE', 'MEC Limit'))
  const guideline = limit(value('COVERAGE', 'Guideline Premium Limit'))

  return {
    policyNumber: expectedPolicyNumber,
    sourcePath: input.navigatePath,
    observedAt,
    coverageCaptured: input.fields.some((field) => field.section === 'COVERAGE'),
    paymentsCaptured: input.fields.some((field) => field.section === 'PAYMENTS'),
    totalFaceAmount: money(
      value('COVERAGE', 'Total Face Amount') ?? value('COVERAGE', 'Base Face Amount'),
    ),
    netDeathBenefit: money(value('COVERAGE', 'Net Death Benefit')),
    nextScheduledPaymentDate: carrierDate(value('PAYMENTS', 'Next Scheduled Payment Date')),
    paymentFrequency: boundedText(value('PAYMENTS', 'Payment Frequency')),
    plannedPeriodicPayment: money(value('PAYMENTS', 'Planned Periodic Payment')),
    anticipatedAnnualPremium: money(value('PAYMENTS', 'Anticipated Annual Premium')),
    minimumMonthlyPremium: money(value('PAYMENTS', 'Minimum Monthly Premium')),
    minimumGuaranteedPremium: money(value('PAYMENTS', 'Minimum Guaranteed Premium')),
    ctp: money(value('PAYMENTS', 'CTP')),
    mecLimit: mec.amount,
    mecLimitThrough: mec.through,
    guidelinePremiumLimit: guideline.amount,
    guidelinePremiumLimitThrough: guideline.through,
  }
}
