import { planPortfolioIngest, type PlannedPolicy } from './portfolio-plan'
import type { InforceRow } from './portfolio-reconcile'

/// The writes arrive as injected functions rather than a bound Prisma client, for
/// the same reason `raw-ingest.ts` keeps its planning pure: the persist helpers bind
/// the module-level client and cannot run inside a caller's transaction. It also
/// makes this testable without a database.
///
/// There is deliberately no `deletePolicy`. A policy absent from the export is not
/// proof it stopped existing — the carrier may simply have changed a filter.
export type IngestDeps = {
  loadInforceRows: (agentId: string) => Promise<InforceRow[]>
  loadClients: (agentId: string) => Promise<{ id: string; name: string; dateOfBirth: Date | null }[]>
  createClient: (input: {
    agentId: string
    name: string
    dateOfBirth: Date | null
    email: string | null
    phone: string | null
  }) => Promise<{ id: string }>
  upsertPolicy: (input: PlannedPolicy & { agentId: string; clientId: string }) => Promise<void>
}

export type IngestReport = {
  clientsCreated: number
  policiesUpserted: number
  needsFaceAmount: number
  lowConfidence: { policyNumber: string; clientId: string; name: string }[]
  discarded: number
  failed: { policyNumber: string; reason: string }[]
}

export async function ingestNationalLifePortfolio(
  deps: IngestDeps,
  input: { agentId: string },
): Promise<IngestReport> {
  const [rows, existingClients] = await Promise.all([
    deps.loadInforceRows(input.agentId),
    deps.loadClients(input.agentId),
  ])

  const plan = planPortfolioIngest({ rows, existingClients })

  const report: IngestReport = {
    clientsCreated: 0,
    policiesUpserted: 0,
    needsFaceAmount: plan.needsFaceAmount.length,
    lowConfidence: plan.lowConfidence,
    discarded: plan.discarded.length,
    failed: [],
  }

  const createdIdByKey = new Map<string, string>()
  for (const client of plan.clientsToCreate) {
    const created = await deps.createClient({
      agentId: input.agentId,
      name: client.name,
      dateOfBirth: client.dateOfBirth,
      email: client.email,
      phone: client.phone,
    })
    createdIdByKey.set(client.key, created.id)
    report.clientsCreated += 1
  }

  // One policy at a time: a single malformed row must not cost the batch. The
  // failure is reported, never swallowed.
  for (const policy of plan.policies) {
    const clientId =
      policy.clientRef.kind === 'EXISTING'
        ? policy.clientRef.clientId
        : createdIdByKey.get(policy.clientRef.key)
    if (!clientId) {
      report.failed.push({ policyNumber: policy.policyNumber, reason: 'CLIENT_UNRESOLVED' })
      continue
    }
    try {
      await deps.upsertPolicy({ ...policy, agentId: input.agentId, clientId })
      report.policiesUpserted += 1
    } catch (error) {
      report.failed.push({
        policyNumber: policy.policyNumber,
        reason: error instanceof Error ? error.message : 'UNKNOWN',
      })
    }
  }

  return report
}

/// Called at the end of a run, outside the stage transaction — the persist helpers
/// bind the module-level Prisma client and cannot run inside it.
///
/// Swallows its own failures on purpose. The connector is blocked on the response
/// that triggers this, and a portfolio that could not be written is a problem for
/// the portfolio, not a reason to tell the device its sync failed. The report comes
/// back as `null` so the caller can say nothing rather than say something false.
export async function ingestPortfolioIfRunFinished(
  deps: IngestDeps,
  input: { agentId: string; terminal: boolean },
): Promise<IngestReport | null> {
  if (!input.terminal) return null
  try {
    return await ingestNationalLifePortfolio(deps, { agentId: input.agentId })
  } catch {
    return null
  }
}
