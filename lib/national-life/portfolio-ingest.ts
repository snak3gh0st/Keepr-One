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
  /**
   * The portfolio may only be promoted from the raw pages that completed on
   * this exact signed device/run. Reading the agent-wide normalized table here
   * would let a terminal run publish pages another device has only partly
   * landed.
   */
  loadInforceRows: (input: PortfolioRunScope) => Promise<(InforceRow & { sourceObservedAt?: Date })[] | null>
  loadClients: (agentId: string) => Promise<{
    id: string
    name: string
    dateOfBirth: Date | null
    email: string | null
    phone: string | null
  }[]>
  createClient: (input: {
    agentId: string
    name: string
    dateOfBirth: Date | null
    email: string | null
    phone: string | null
  }) => Promise<{ id: string }>
  /**
   * Fills contact gaps on a client the CRM already had. Scoped by agent so a
   * carrier row can never reach another producer's record.
   */
  /// Resolves to whether a row actually changed, so the report counts writes
  /// that landed rather than writes that were attempted: the field may have
  /// been filled between the snapshot read and this update.
  updateClientContact: (input: {
    agentId: string
    clientId: string
    email: string | null
    phone: string | null
  }) => Promise<boolean>
  upsertPolicy: (input: PlannedPolicy & { agentId: string; clientId: string; sourceObservedAt?: Date }) => Promise<void>
}

export type PortfolioRunScope = {
  agentId: string
  deviceId: string
  runId: string
}

export type IngestReport = {
  clientsCreated: number
  clientsContactFilled: number
  policiesUpserted: number
  needsFaceAmount: number
  lowConfidence: { policyNumber: string; clientId: string; name: string }[]
  discarded: number
  failed: { policyNumber: string; reason: string }[]
}

/// A data de nascimento é o que separa dois homônimos, e `matchClient` trata a
/// sua ausência como notícia sobre a pessoa. Quando a coleta perde a coluna
/// inteira, essa leitura vira mentira: cada cliente já conhecido deixa de casar
/// com a sua própria linha e nasce de novo, sem data, ao lado do original.
/// Foi assim que uma coleta de 04/09/2026 com InsuredDOB vazio nas 9.826 linhas
/// virou 8.508 clones em 12/09 — 97,8% do livro duplicado.
///
/// O teste é deliberadamente o caso binário observado, sem limiar a calibrar:
/// nenhuma linha com data, tendo o CRM datas guardadas. Uma pessoa sem data é
/// ausência de informação sobre ela; a coluna inteira vazia é defeito de
/// coleta. Sem data nenhuma no CRM não há o que contradizer, e um agente cujo
/// livro nunca teve datas não pode ficar travado para sempre.
function dateOfBirthColumnIsBlank(
  rows: readonly InforceRow[],
  existingClients: readonly { dateOfBirth: Date | null }[],
): boolean {
  if (rows.length === 0) return false
  if (rows.some((row) => (row.insuredDob ?? '').trim() !== '')) return false
  return existingClients.some((client) => client.dateOfBirth !== null)
}

export async function ingestNationalLifePortfolio(
  deps: IngestDeps,
  input: PortfolioRunScope,
): Promise<IngestReport> {
  const [rows, existingClients] = await Promise.all([
    deps.loadInforceRows(input),
    deps.loadClients(input.agentId),
  ])

  // An empty verified export is a valid portfolio. `null` specifically means
  // the completion/raw-page proof is absent or inconsistent, and must never be
  // treated as an empty account book.
  if (rows === null) throw new Error('NATIONAL_PORTFOLIO_SNAPSHOT_UNAVAILABLE')

  if (dateOfBirthColumnIsBlank(rows, existingClients)) {
    throw new Error('NATIONAL_PORTFOLIO_DOB_COLUMN_BLANK')
  }

  const plan = planPortfolioIngest({ rows, existingClients })
  const sourceTimes = rows.flatMap((row) => row.sourceObservedAt ? [row.sourceObservedAt.getTime()] : [])
  const sourceObservedAt = sourceTimes.length ? new Date(Math.max(...sourceTimes)) : undefined

  const report: IngestReport = {
    clientsCreated: 0,
    clientsContactFilled: 0,
    policiesUpserted: 0,
    needsFaceAmount: plan.needsFaceAmount.length,
    lowConfidence: plan.lowConfidence,
    discarded: plan.discarded.length,
    failed: [],
  }

  // Backfilling contact details must never cost the caller a policy. A client
  // row that refuses the update leaves the gap for the next run to retry.
  for (const contact of plan.clientsToUpdate) {
    try {
      const filled = await deps.updateClientContact({
        agentId: input.agentId,
        clientId: contact.clientId,
        email: contact.email,
        phone: contact.phone,
      })
      if (filled) report.clientsContactFilled += 1
    } catch {
      // Intentionally swallowed: the portfolio is the deliverable here.
    }
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
      await deps.upsertPolicy({ ...policy, agentId: input.agentId, clientId, sourceObservedAt })
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
  input: PortfolioRunScope & { terminal: boolean },
): Promise<IngestReport | null> {
  if (!input.terminal) return null
  try {
    return await ingestNationalLifePortfolio(deps, {
      agentId: input.agentId,
      deviceId: input.deviceId,
      runId: input.runId,
    })
  } catch (error) {
    // Engolir não pode significar não deixar rastro: um export recusado pelo
    // gate acima some sem uma linha de log, e a falha muda é justamente o que
    // custou caro aqui. O retorno continua `null` — quem chama segue sem dizer
    // nada ao dispositivo.
    console.error('[national-life] portfolio ingest failed', {
      agentId: input.agentId,
      runId: input.runId,
      reason: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return null
  }
}
