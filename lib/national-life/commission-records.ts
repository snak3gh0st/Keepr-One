/// Turns the carrier's commission earning detail into the shape the app reports
/// on, without writing it to `CommissionRecord`.
///
/// Why not promote: `CommissionRecord.policyId` is required, and only 2329 of
/// 5408 carrier transactions reference a policy in the current book — the rest
/// are policies that still pay renewals but are no longer inforce. Promoting the
/// ones that join would show 43% of an agent's commission as if it were all of
/// it, which is worse than showing nothing.
///
/// The commissions page already read the carrier rows this way. The dashboard
/// did not, and summed only `CommissionRecord` — which is empty — so the same
/// agent saw real commissions on one page and zero on another. This module
/// exists so both read one source.
export type CarrierCommissionRow = {
  id: string
  raw: unknown
  amounts: unknown
}

export type ScopedCarrierCommissionRow = CarrierCommissionRow & {
  agentId: string
}

export type ScopedCarrierFinancialRow = ScopedCarrierCommissionRow & {
  primaryDate?: unknown
  fetchedAt?: unknown
}

export type CarrierMoneySnapshot = {
  total: number
  /** Latest carrier effective date included in the snapshot. */
  asOf: string | null
  rowCount: number
}

export type CarrierCommissionRecord = {
  id: string
  period: string
  type: 'DIRECT' | 'OVERRIDE'
  level: number
  amount: number
  policyNumber: string
  writingAgentName: string
}

export const NO_PERIOD = 'sem-periodo'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function toCarrierDateKey(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }

  const text = asString(value)?.trim()
  if (!text) return null
  const carrierDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text)
  if (carrierDate) {
    return `${carrierDate[3]}-${carrierDate[1].padStart(2, '0')}-${carrierDate[2].padStart(2, '0')}`
  }
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : null
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime()
  const text = asString(value)
  if (!text) return 0
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? 0 : parsed
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/// Carrier money arrives as a display string — "$1,234.56", sometimes negative.
export function parseCarrierAmount(value: unknown): number | null {
  const text = asString(value)
  if (!text) return null
  const negative = /^\s*[(-]/.test(text)
  const digits = text.replace(/[^\d.]/g, '')
  if (digits === '' || digits === '.') return null
  const parsed = Number(digits)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

/// `MM/DD/YYYY` to the `YYYY-MM` the app groups by. Rows without a usable date
/// are kept under NO_PERIOD rather than dropped: their money is still real, and
/// silently discarding it is how a total goes quietly wrong.
export function toPeriod(paymentDate: unknown): string {
  const text = asString(paymentDate)
  if (!text) return NO_PERIOD
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text.trim())
  if (!match) return NO_PERIOD
  return `${match[3]}-${match[1].padStart(2, '0')}`
}

export function classifyCarrierCommissionLevel(
  value: unknown,
): CarrierCommissionRecord['type'] | null {
  const normalized = asString(value)?.trim().toLowerCase()
  if (normalized === 'personal') return 'DIRECT'
  if (normalized === 'override') return 'OVERRIDE'
  return null
}

export function toCarrierCommissionRecords(
  rows: readonly CarrierCommissionRow[],
): CarrierCommissionRecord[] {
  return rows.flatMap((row) => {
    const raw = asRecord(row.raw)
    const amounts = asRecord(row.amounts)
    const amount = parseCarrierAmount(amounts.GrossCommEarned ?? raw.GrossCommEarned)
    if (amount === null) return []

    // Fail closed on missing or novel carrier labels. Treating every value
    // except "Override" as personal could expose a new team-level row after a
    // carrier schema change.
    const type = classifyCarrierCommissionLevel(raw.WritingAgtLevel)
    if (type === null) return []
    const isOverride = type === 'OVERRIDE'

    return [
      {
        id: row.id,
        period: toPeriod(raw.PaymentDate),
        type,
        level: isOverride ? 1 : 0,
        amount,
        policyNumber: asString(raw.PolicyNumber) ?? '—',
        writingAgentName: asString(raw.WritingAgtName) ?? '',
      },
    ]
  })
}

/**
 * An override belongs to the agent whose authenticated National Life connector
 * returned it. Agency owners may also see direct production from entitled
 * members, but importing those members' overrides would both expose an outside
 * producer name and risk counting the same hierarchy payment more than once.
 */
export function toVisibleCarrierCommissionRecords(
  rows: readonly ScopedCarrierCommissionRow[],
  currentAgentId: string,
): CarrierCommissionRecord[] {
  const ownerByRecordId = new Map(rows.map((row) => [row.id, row.agentId]))
  return toCarrierCommissionRecords(rows).filter((record) =>
    record.type === 'DIRECT' || ownerByRecordId.get(record.id) === currentAgentId,
  )
}

export function totalOf(records: readonly CarrierCommissionRecord[]): number {
  return records.reduce((sum, record) => sum + record.amount, 0)
}

export function totalForPeriod(
  records: readonly CarrierCommissionRecord[],
  period: string,
): number {
  return totalOf(records.filter((record) => record.period === period))
}

/// Totals per period, ascending, restricted to a window. NO_PERIOD is excluded
/// here on purpose: a trend chart plots time, and a bucket that is not a time
/// would render as one.
export function sumByPeriod(
  records: readonly CarrierCommissionRecord[],
  range?: { from: string; to: string },
): Array<{ period: string; total: number }> {
  const totals = new Map<string, number>()
  for (const record of records) {
    if (record.period === NO_PERIOD) continue
    if (range && (record.period < range.from || record.period > range.to)) continue
    totals.set(record.period, (totals.get(record.period) ?? 0) + record.amount)
  }
  return [...totals.entries()]
    .map(([period, total]) => ({ period, total }))
    .sort((left, right) => left.period.localeCompare(right.period))
}

const PAYABLE_AMOUNT_FIELDS = [
  'NLLifeAmount',
  'NLAnnuitiesAmount',
  'NLMutualFundsAmount',
  'LSWLifeAmount',
  'LSWAnnuitiesAmount',
  'VariableProductAmount',
] as const

/**
 * Payable Gross Commissions is a projection, not proof of payment. The portal
 * can resend a corrected row with the same business identity, so retain only
 * the newest version before calculating the selected month.
 */
export function projectedPayableSnapshotForPeriod(
  rows: readonly ScopedCarrierFinancialRow[],
  period: string,
): CarrierMoneySnapshot {
  const latestByBusinessKey = new Map<string, ScopedCarrierFinancialRow>()

  for (const row of rows) {
    const raw = asRecord(row.raw)
    const paymentDate = raw.PaymentDate ?? row.primaryDate
    if (toPeriod(paymentDate) !== period) continue

    const agentNumber = asString(raw.AgentNumber)
    const writingAgentNumber = asString(raw.WritingAgentNumber)
    const dateKey = toCarrierDateKey(paymentDate)
    const businessKey = dateKey && (agentNumber || writingAgentNumber)
      ? [row.agentId, dateKey, agentNumber ?? '', writingAgentNumber ?? ''].join(':')
      : `${row.agentId}:${row.id}`
    const previous = latestByBusinessKey.get(businessKey)
    if (!previous || timestamp(row.fetchedAt) >= timestamp(previous.fetchedAt)) {
      latestByBusinessKey.set(businessKey, row)
    }
  }

  let total = 0
  let asOf: string | null = null
  for (const row of latestByBusinessKey.values()) {
    const raw = asRecord(row.raw)
    const amounts = asRecord(row.amounts)
    for (const field of PAYABLE_AMOUNT_FIELDS) {
      total += parseCarrierAmount(amounts[field] ?? raw[field]) ?? 0
    }
    const dateKey = toCarrierDateKey(raw.PaymentDate ?? row.primaryDate)
    if (dateKey && (!asOf || dateKey > asOf)) asOf = dateKey
  }

  return { total: roundMoney(total), asOf, rowCount: latestByBusinessKey.size }
}

/**
 * Chargeback is a statement balance. Adding every historical statement would
 * multiply the same liability, so use the latest statement date independently
 * for each entitled agent and add only its explicit balance rows.
 */
export function currentCarrierChargebackSnapshot(
  rows: readonly ScopedCarrierFinancialRow[],
): CarrierMoneySnapshot {
  const latestDateByAgent = new Map<string, string>()
  const datedRows: Array<{ row: ScopedCarrierFinancialRow; dateKey: string }> = []

  for (const row of rows) {
    const raw = asRecord(row.raw)
    const dateKey = toCarrierDateKey(raw.PayDate ?? row.primaryDate)
    if (!dateKey) continue
    datedRows.push({ row, dateKey })
    const previous = latestDateByAgent.get(row.agentId)
    if (!previous || dateKey > previous) latestDateByAgent.set(row.agentId, dateKey)
  }

  let total = 0
  let asOf: string | null = null
  let rowCount = 0
  for (const { row, dateKey } of datedRows) {
    if (latestDateByAgent.get(row.agentId) !== dateKey) continue
    const raw = asRecord(row.raw)
    const amounts = asRecord(row.amounts)
    total += parseCarrierAmount(amounts.CommChargebackBalance ?? raw.CommChargebackBalance) ?? 0
    rowCount += 1
    if (!asOf || dateKey > asOf) asOf = dateKey
  }

  return { total: roundMoney(total), asOf, rowCount }
}
