export type NationalLifePromotionPaymentEvidence = {
  policyNumber: string
  writingAgentNumber: string
  paymentDate: Date
  paymentDateRaw: string
  compensationType: 'First year Compensation'
  transactionType: 'Standard'
  incomeClass: string | null
  productType: string | null
  lifeEvidenceField: 'IncomeClass' | 'ProductType'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Accepts either a carrier GridRow or a persisted NationalLifeReportRow. */
function carrierRow(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record) return null
  if (!Object.hasOwn(record, 'raw')) return record
  return asRecord(record.raw)
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized || null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function classifier(value: unknown): string | null {
  return typeof value === 'string' ? text(value) : null
}

function normalizedClassifier(value: string | null): string | null {
  return value
    ? value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    : null
}

function canonicalPolicyNumber(value: unknown): string | null {
  const source = text(value)
  if (!source) return null
  const canonical = source.toUpperCase().replace(/\s+/g, '')
  if (canonical.length > 64 || !/^[A-Z0-9-]+$/.test(canonical)) return null
  return canonical
}

function canonicalAgentNumber(value: unknown): string | null {
  const source = text(value)
  if (!source) return null
  const canonical = source.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!canonical || canonical.length > 64) return null
  return canonical
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null
}

function paymentDate(value: unknown): { date: Date; raw: string } | null {
  const raw = typeof value === 'string' ? value.trim() : null
  if (!raw) return null

  const carrier = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  if (carrier) {
    const date = utcDate(Number(carrier[3]), Number(carrier[1]), Number(carrier[2]))
    return date ? { date, raw } : null
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (iso) {
    const date = utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return date ? { date, raw } : null
  }

  return null
}

/**
 * Extracts the narrow carrier evidence that a standard first-year Life earning
 * was paid. The result deliberately excludes the raw row and all incidental PII.
 */
export function toNationalLifePromotionPaymentEvidence(
  value: unknown,
): NationalLifePromotionPaymentEvidence | null {
  const row = carrierRow(value)
  if (!row) return null

  const policyNumber = canonicalPolicyNumber(row.PolicyNumber)
  const writingAgentNumber = canonicalAgentNumber(row.WritingAgtNumber)
  const paid = paymentDate(row.PaymentDate)
  const compensationType = classifier(row.CompensationType)
  const transactionType = classifier(row.TransactionType)
  const incomeClass = classifier(row.IncomeClass)
  const productType = classifier(row.ProductType)

  if (
    !policyNumber ||
    !writingAgentNumber ||
    !paid ||
    normalizedClassifier(compensationType) !== 'first year compensation' ||
    normalizedClassifier(transactionType) !== 'standard'
  ) {
    return null
  }

  const lifeEvidenceField = normalizedClassifier(incomeClass) === 'life'
    ? 'IncomeClass' as const
    : normalizedClassifier(productType) === 'life'
      ? 'ProductType' as const
      : null
  if (!lifeEvidenceField) return null

  return {
    policyNumber,
    writingAgentNumber,
    paymentDate: paid.date,
    paymentDateRaw: paid.raw,
    compensationType: 'First year Compensation',
    transactionType: 'Standard',
    incomeClass,
    productType,
    lifeEvidenceField,
  }
}
