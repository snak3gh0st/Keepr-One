import {
  reconcileInforceRows,
  type DiscardedRow,
  type InforceRow,
  type PolicyStatusName,
} from './portfolio-reconcile'
import { matchClient, normalizeClientName, type ClientCandidate } from './portfolio-identity'

export const NATIONAL_LIFE_PROVIDER = 'NATIONAL_LIFE'
export const NATIONAL_LIFE_CARRIER = 'National Life Group'

export type ClientRef =
  | { kind: 'EXISTING'; clientId: string }
  | { kind: 'NEW'; key: string }

export type PlannedClient = {
  key: string
  name: string
  dateOfBirth: Date | null
  email: string | null
  phone: string | null
}

export type PlannedPolicy = {
  sourceProvider: typeof NATIONAL_LIFE_PROVIDER
  sourceExternalId: string
  policyNumber: string
  carrier: typeof NATIONAL_LIFE_CARRIER
  product: string
  status: PolicyStatusName
  sourceStatus: string | null
  statusChangedAt: Date | null
  faceAmount: null
  premium: number | null
  effectiveDate: Date | null
  clientRef: ClientRef
}

export type LowConfidenceMatch = { policyNumber: string; clientId: string; name: string }

/// Contact details the carrier holds for a client the CRM already knows.
///
/// Only ever emitted for a field the existing record leaves blank. An agent who
/// typed a phone number is a better source than a carrier export, so this fills
/// gaps and never overwrites — the ingestion has no way to tell a corrected
/// number from a stale one, and silently replacing the agent's own work would
/// be the worse failure.
export type PlannedClientContact = {
  clientId: string
  email: string | null
  phone: string | null
}

export type DiscardedEntry = DiscardedRow | { reason: 'MISSING_INSURED_NAME'; policyStatus: string | null }

export type PortfolioIngestPlan = {
  clientsToCreate: PlannedClient[]
  clientsToUpdate: PlannedClientContact[]
  policies: PlannedPolicy[]
  needsFaceAmount: string[]
  lowConfidence: LowConfidenceMatch[]
  discarded: DiscardedEntry[]
}

/// Face amount is deliberately absent here, never zero: it does not exist in any of
/// the export's 33 columns and arrives later, per policy, from the detail page.
///
/// `needsFaceAmount` lists every policy this plan touched, not the backfill queue.
/// Planning is pure and cannot know which rows already carry a face amount from an
/// earlier backfill. The backfill stage selects its own work with
/// `faceAmount IS NULL`, which is both simpler and correct; this count exists so the
/// sync can report how much of the book is still unpriced.
export function planPortfolioIngest(input: {
  rows: InforceRow[]
  existingClients: readonly ClientCandidate[]
}): PortfolioIngestPlan {
  const { policies: reconciled, discarded: reconcileDiscarded } = reconcileInforceRows(input.rows)

  const plan: PortfolioIngestPlan = {
    clientsToCreate: [],
    clientsToUpdate: [],
    policies: [],
    needsFaceAmount: [],
    lowConfidence: [],
    discarded: [...reconcileDiscarded],
  }

  // Clients planned in this same run must be visible to later policies, or two
  // policies of one person would plan that person twice.
  const plannedByKey = new Map<string, PlannedClient>()
  // One entry per client, so two policies of the same person do not queue two
  // writes for the same gap.
  const contactGaps = new Map<string, PlannedClientContact>()

  for (const policy of reconciled) {
    if (!policy.insuredName) {
      plan.discarded.push({ reason: 'MISSING_INSURED_NAME', policyStatus: policy.sourceStatus })
      continue
    }

    const key = `${normalizeClientName(policy.insuredName)}|${policy.insuredDateOfBirth?.toISOString() ?? ''}`
    const alreadyPlanned = plannedByKey.get(key)
    let clientRef: ClientRef

    if (alreadyPlanned) {
      clientRef = { kind: 'NEW', key }
    } else {
      const match = matchClient(
        { id: null, name: policy.insuredName, dateOfBirth: policy.insuredDateOfBirth },
        input.existingClients,
      )
      if (match.kind === 'CREATE') {
        const planned: PlannedClient = {
          key,
          name: policy.insuredName,
          dateOfBirth: policy.insuredDateOfBirth,
          email: policy.insuredEmail,
          phone: policy.insuredPhone,
        }
        plannedByKey.set(key, planned)
        plan.clientsToCreate.push(planned)
        clientRef = { kind: 'NEW', key }
      } else {
        clientRef = { kind: 'EXISTING', clientId: match.clientId }
        planContactBackfill(plan, contactGaps, input.existingClients, match.clientId, policy)
        if (match.kind === 'MATCHED_LOW_CONFIDENCE') {
          plan.lowConfidence.push({
            policyNumber: policy.policyNumber,
            clientId: match.clientId,
            name: policy.insuredName,
          })
        }
      }
    }

    plan.policies.push({
      sourceProvider: NATIONAL_LIFE_PROVIDER,
      sourceExternalId: policy.policyNumber,
      policyNumber: policy.policyNumber,
      carrier: NATIONAL_LIFE_CARRIER,
      product: policy.productName ?? 'Unknown',
      status: policy.status,
      sourceStatus: policy.sourceStatus,
      statusChangedAt: policy.statusChangedAt,
      faceAmount: null,
      premium: policy.premium,
      effectiveDate: policy.issueDate,
      clientRef,
    })
    plan.needsFaceAmount.push(policy.policyNumber)
  }

  return plan
}


/// Records a contact backfill for an already-known client.
///
/// A field is filled only when the CRM leaves it blank and the carrier supplies
/// something. The first policy that offers a value wins: later rows for the same
/// person carry the same contact details, and preferring a later one would just
/// make the result depend on export order.
function planContactBackfill(
  plan: PortfolioIngestPlan,
  gaps: Map<string, PlannedClientContact>,
  existing: readonly ClientCandidate[],
  clientId: string,
  policy: { insuredEmail: string | null; insuredPhone: string | null },
): void {
  const current = existing.find((one) => one.id === clientId)
  if (!current) return

  const email = blank(current.email) ? trimmed(policy.insuredEmail) : null
  const phone = blank(current.phone) ? trimmed(policy.insuredPhone) : null
  if (!email && !phone) return

  const queued = gaps.get(clientId)
  if (queued) {
    queued.email = queued.email ?? email
    queued.phone = queued.phone ?? phone
    return
  }

  const entry: PlannedClientContact = { clientId, email, phone }
  gaps.set(clientId, entry)
  plan.clientsToUpdate.push(entry)
}

function trimmed(value: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === ''
}
