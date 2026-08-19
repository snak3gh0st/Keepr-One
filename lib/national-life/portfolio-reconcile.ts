/// The carrier's book reaches us in two disjoint slices and neither is complete.
/// The official export carries premium, address and contact but no date of birth;
/// the legacy grid carries date of birth and no premium. Reconciling is therefore
/// per field, not per slice — there is no winning source, only a winning value.

const EXPORT_SCOPE = 'LOCAL_CONNECTOR'

export type InforceRow = {
  deploymentScope: string
  policyNumber: string
  policyStatus: string | null
  policyIssueDate: string | null
  productName: string | null
  insuredClientName: string | null
  insuredDob: string | null
  insuredEmail: string | null
  insuredPhoneNumber: string | null
  insuredZipcode: string | null
  ownerClientName: string | null
  anticipatedAnnualPremium: string | null
}

export type PolicyStatusName = 'PENDING' | 'APPROVED' | 'INFORCE' | 'LAPSED' | 'CANCELLED'

export type ReconciledPolicy = {
  policyNumber: string
  status: PolicyStatusName
  sourceStatus: string | null
  productName: string | null
  issueDate: Date | null
  premium: number | null
  insuredName: string | null
  insuredDateOfBirth: Date | null
  insuredEmail: string | null
  insuredPhone: string | null
  ownerName: string | null
}

export type DiscardedRow = { reason: 'MISSING_POLICY_NUMBER'; policyStatus: string | null }

export type ReconcileResult = { policies: ReconciledPolicy[]; discarded: DiscardedRow[] }

/// `Pending Lapse` has no home in PolicyStatus, and it is the one status with money
/// still recoverable behind it. It maps to INFORCE so the policy reads as live, and
/// `sourceStatus` keeps the carrier's own word so the signal survives.
const STATUS_BY_CARRIER_LABEL: Record<string, PolicyStatusName> = {
  active: 'INFORCE',
  issued: 'APPROVED',
  'pending lapse': 'INFORCE',
  lapsed: 'LAPSED',
  'not active': 'CANCELLED',
}

function mapStatus(carrier: string | null): PolicyStatusName {
  return STATUS_BY_CARRIER_LABEL[(carrier ?? '').trim().toLowerCase()] ?? 'PENDING'
}

/// The carrier writes dates as MM/DD/YYYY. Parsed into UTC so a birthday does not
/// drift a day for an agent in a negative offset.
function parseCarrierDate(value: string | null): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim())
  if (!match) return null
  const [, month, day, year] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return Number.isNaN(date.getTime()) ? null : date
}

function parseMoney(value: string | null): number | null {
  const cleaned = (value ?? '').replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}

function text(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/// `??` rather than `||` throughout: a legitimately empty value must not be
/// overwritten by a later slice just because it is falsy.
function coalesce<T>(current: T | null, incoming: T | null): T | null {
  return current ?? incoming
}

export function reconcileInforceRows(rows: InforceRow[]): ReconcileResult {
  const byPolicy = new Map<string, ReconciledPolicy>()
  const discarded: DiscardedRow[] = []

  // The export's trailing banner rows ("Exported On: ...", "Exported By: ...")
  // arrive in the same shape as data, and in production the upstream parser
  // copies that same banner string into every column of the row — including
  // `PolicyNumber` — rather than leaving it blank. A real carrier policy number
  // never starts with "Exported ", so that prefix is treated the same as a
  // missing one.
  const EXPORT_BANNER_PREFIX = /^Exported (On|By):/
  for (const row of rows) {
    const policyNumber = text(row.policyNumber)
    if (!policyNumber || EXPORT_BANNER_PREFIX.test(policyNumber)) {
      discarded.push({ reason: 'MISSING_POLICY_NUMBER', policyStatus: row.policyStatus })
      continue
    }

    const isExport = row.deploymentScope === EXPORT_SCOPE
    const existing = byPolicy.get(policyNumber)
    const incoming: ReconciledPolicy = {
      policyNumber,
      status: mapStatus(row.policyStatus),
      sourceStatus: text(row.policyStatus),
      productName: text(row.productName),
      issueDate: parseCarrierDate(row.policyIssueDate),
      premium: parseMoney(row.anticipatedAnnualPremium),
      insuredName: text(row.insuredClientName),
      insuredDateOfBirth: parseCarrierDate(row.insuredDob),
      insuredEmail: text(row.insuredEmail),
      insuredPhone: text(row.insuredPhoneNumber),
      ownerName: text(row.ownerClientName),
    }

    if (!existing) {
      byPolicy.set(policyNumber, incoming)
      continue
    }

    // Status, product and contact come from the export when it has them; date of
    // birth only ever comes from the legacy grid, so it is merged either way.
    byPolicy.set(policyNumber, {
      policyNumber,
      status: isExport ? incoming.status : existing.status,
      sourceStatus: isExport ? incoming.sourceStatus : existing.sourceStatus,
      productName: isExport
        ? coalesce(incoming.productName, existing.productName)
        : coalesce(existing.productName, incoming.productName),
      issueDate: coalesce(existing.issueDate, incoming.issueDate),
      premium: isExport
        ? coalesce(incoming.premium, existing.premium)
        : coalesce(existing.premium, incoming.premium),
      insuredName: coalesce(existing.insuredName, incoming.insuredName),
      insuredDateOfBirth: coalesce(existing.insuredDateOfBirth, incoming.insuredDateOfBirth),
      insuredEmail: isExport
        ? coalesce(incoming.insuredEmail, existing.insuredEmail)
        : coalesce(existing.insuredEmail, incoming.insuredEmail),
      insuredPhone: isExport
        ? coalesce(incoming.insuredPhone, existing.insuredPhone)
        : coalesce(existing.insuredPhone, incoming.insuredPhone),
      ownerName: coalesce(existing.ownerName, incoming.ownerName),
    })
  }

  return { policies: [...byPolicy.values()], discarded }
}
