import { parse } from 'csv-parse/sync'
import { prisma } from '@/lib/prisma'
import { computeOverrides } from '@/lib/commission'
import { ensureAnnualReview, REVIEWABLE_POLICY_STATUS } from '@/lib/policy-reviews'
import { PolicyRowSchema, CommissionRowSchema } from './schemas'

export function parseCsv(content: string): Record<string, string>[] {
  return parse(content, { columns: true, skip_empty_lines: true, trim: true })
}

export function shouldUpdateStatusChangedAt(
  existing: { status: string } | null,
  newStatus: string,
): boolean {
  return existing === null || existing.status !== newStatus
}

export function statusChangedAtForCreate(status: string): Date | null {
  return status === 'LAPSED' || status === 'CANCELLED' ? null : new Date()
}

// A manually uploaded CSV has no upstream provider; label those rows so the
// external-reference uniqueness constraints still have a stable namespace.
export const MANUAL_IMPORT_PROVIDER = 'MANUAL_IMPORT'

export function resolveImportProvider(sourceProvider?: string | null): string {
  const trimmed = sourceProvider?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : MANUAL_IMPORT_PROVIDER
}

// Provider-neutral external id for a policy snapshot. Prefer the carrier's own
// id; fall back to the policy number so a manual re-import upserts the same
// snapshot row instead of duplicating it.
export function resolvePolicyExternalId(sourceExternalId: string | null | undefined, policyNumber: string): string {
  const trimmed = sourceExternalId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : policyNumber
}

// Stable source id for a commission transaction so re-uploading the same file
// upserts in place (no duplicated money) rather than inserting again. Prefer an
// explicit id from the feed; otherwise derive one deterministically.
export function deriveCommissionSourceId(input: {
  sourceTransactionId?: string | null
  filename: string
  rowNumber: number
  policyNumber: string
  agentNpn: string
  period: string
}): string {
  const explicit = input.sourceTransactionId?.trim()
  if (explicit) return explicit
  return [input.filename, input.rowNumber, input.policyNumber, input.agentNpn, input.period].join('|')
}

// period is validated as 'YYYY-MM'; anchor the transaction to the first of the
// month so ordering and aggregation have a concrete instant.
export function periodToDate(period: string): Date {
  return new Date(`${period}-01T00:00:00.000Z`)
}

export type ImportStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED'

type ImportResult = {
  batchId: string
  status: ImportStatus
  successCount: number
  errors: { row: number; message: string }[]
}

export function deriveStatus(successCount: number, errorCount: number): ImportStatus {
  if (errorCount === 0) return 'COMPLETED'
  return successCount === 0 ? 'FAILED' : 'COMPLETED_WITH_ERRORS'
}

// A CSV that isn't actually CSV (wrong delimiter, a renamed .xlsx, a stray
// unescaped quote) makes csv-parse throw synchronously rather than reject a
// row. Without this, that throw would propagate all the way to the server
// action with no batch record and no row number — the exact "blank crash on
// a malformed file" failure mode this import flow otherwise avoids.
export function safeParseCsv(content: string): { rows: Record<string, string>[] } | { error: string } {
  try {
    return { rows: parseCsv(content) }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { error: `Não foi possível ler o arquivo como CSV: ${reason}` }
  }
}

export async function importPolicies(content: string, uploadedById: string, filename: string): Promise<ImportResult> {
  const batch = await prisma.importBatch.create({
    data: { uploadedById, filename, type: 'POLICIES', status: 'PROCESSING' },
  })

  const parseResult = safeParseCsv(content)
  if ('error' in parseResult) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', rowErrors: [{ row: 0, message: parseResult.error }] },
    })
    return { batchId: batch.id, status: 'FAILED', successCount: 0, errors: [{ row: 0, message: parseResult.error }] }
  }
  const rows = parseResult.rows

  const errors: { row: number; message: string }[] = []
  let successCount = 0

  for (const [index, rawRow] of rows.entries()) {
    const parsed = PolicyRowSchema.safeParse(rawRow)
    if (!parsed.success) {
      errors.push({ row: index + 2, message: parsed.error.issues.map((i) => i.message).join('; ') })
      continue
    }
    const row = parsed.data
    const agent = await prisma.agent.findUnique({ where: { npn: row.agentNpn } })
    if (!agent) {
      errors.push({ row: index + 2, message: `Nenhum agente encontrado com NPN ${row.agentNpn}` })
      continue
    }
    const client = await prisma.client.upsert({
      where: { id: `${agent.id}:${row.clientName}` },
      create: {
        id: `${agent.id}:${row.clientName}`,
        name: row.clientName,
        email: row.clientEmail || undefined,
        assignedAgentId: agent.id,
      },
      update: {},
    })
    const existingPolicy = await prisma.policy.findUnique({
      where: { policyNumber: row.policyNumber },
      select: { status: true },
    })
    const statusChangedAt = shouldUpdateStatusChangedAt(existingPolicy, row.status)
      ? new Date()
      : undefined
    const lastPaymentDate = row.lastPaymentDate ? new Date(row.lastPaymentDate) : null
    const policy = await prisma.policy.upsert({
      where: { policyNumber: row.policyNumber },
      create: {
        clientId: client.id,
        agentId: agent.id,
        carrier: row.carrier,
        product: row.product,
        policyNumber: row.policyNumber,
        faceAmount: row.faceAmount,
        premium: row.premium,
        status: row.status,
        effectiveDate: row.effectiveDate ? new Date(row.effectiveDate) : null,
        lastPaymentDate,
        statusChangedAt: statusChangedAtForCreate(row.status),
        importBatchId: batch.id,
        sourceProvider: row.sourceProvider ?? null,
        sourceExternalId: row.sourceExternalId ?? null,
      },
      update: {
        carrier: row.carrier,
        product: row.product,
        faceAmount: row.faceAmount,
        premium: row.premium,
        status: row.status,
        lastPaymentDate,
        ...(statusChangedAt ? { statusChangedAt } : {}),
        importBatchId: batch.id,
      },
      select: { id: true },
    })

    // Append a point-in-time snapshot from ONLY the columns we actually have.
    // Cash value, loan balance and charges have no CSV column, so we never
    // fabricate them. Idempotent on [provider, externalId] so a re-upload
    // updates the same snapshot instead of duplicating it.
    const provider = resolveImportProvider(row.sourceProvider)
    const externalId = resolvePolicyExternalId(row.sourceExternalId, row.policyNumber)
    const snapshotData = {
      status: row.status,
      faceAmount: row.faceAmount,
      plannedPremium: row.premium,
      lastPaymentDate,
      provider,
      externalId,
    }
    await prisma.policySnapshot.upsert({
      where: { provider_externalId: { provider, externalId } },
      create: { policyId: policy.id, ...snapshotData },
      update: snapshotData,
    })

    // Seed an annual review for in-force policies so the yearly cadence starts
    // automatically. Idempotent — re-imports won't duplicate an open review.
    if (row.status === REVIEWABLE_POLICY_STATUS) {
      await ensureAnnualReview(
        policy.id,
        row.effectiveDate ? new Date(row.effectiveDate) : null,
        new Date(),
      )
    }
    successCount += 1
  }

  const status = deriveStatus(successCount, errors.length)
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status, rowErrors: errors },
  })

  return { batchId: batch.id, status, successCount, errors }
}

export async function importCommissions(content: string, uploadedById: string, filename: string): Promise<ImportResult> {
  const batch = await prisma.importBatch.create({
    data: { uploadedById, filename, type: 'COMMISSIONS', status: 'PROCESSING' },
  })

  const parseResult = safeParseCsv(content)
  if ('error' in parseResult) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', rowErrors: [{ row: 0, message: parseResult.error }] },
    })
    return { batchId: batch.id, status: 'FAILED', successCount: 0, errors: [{ row: 0, message: parseResult.error }] }
  }
  const rows = parseResult.rows

  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true, rank: true } })
  const plans = await prisma.commissionPlan.findMany()
  const lookupPlan = (rank: string, level: number) => {
    const plan = plans.find((p) => p.rank === rank && p.downlineLevel === level)
    return plan ? Number(plan.overridePercent) : null
  }

  const errors: { row: number; message: string }[] = []
  let successCount = 0

  for (const [index, rawRow] of rows.entries()) {
    const parsed = CommissionRowSchema.safeParse(rawRow)
    if (!parsed.success) {
      errors.push({ row: index + 2, message: parsed.error.issues.map((i) => i.message).join('; ') })
      continue
    }
    const row = parsed.data
    const agent = await prisma.agent.findUnique({ where: { npn: row.agentNpn } })
    const policy = await prisma.policy.findUnique({ where: { policyNumber: row.policyNumber } })
    if (!agent || !policy) {
      errors.push({
        row: index + 2,
        message: !agent
          ? `Nenhum agente encontrado com NPN ${row.agentNpn}`
          : `Nenhuma apólice encontrada com número ${row.policyNumber}`,
      })
      continue
    }

    // Upsert (rather than create) on the compound unique key so re-uploading
    // the same commission CSV updates existing records in place instead of
    // duplicating money.
    await prisma.commissionRecord.upsert({
      where: {
        policyId_agentId_period_type_level: {
          policyId: policy.id,
          agentId: agent.id,
          period: row.period,
          type: 'DIRECT',
          level: 0,
        },
      },
      create: {
        policyId: policy.id,
        agentId: agent.id,
        amount: row.amount,
        type: 'DIRECT',
        level: 0,
        period: row.period,
        importBatchId: batch.id,
      },
      update: {
        amount: row.amount,
        importBatchId: batch.id,
      },
    })

    // Immutable ledger entry alongside the legacy CommissionRecord (kept for
    // Release 1 so existing dashboards keep working). Upsert on the source id
    // so a duplicate source row updates in place and never duplicates money.
    const provider = resolveImportProvider(row.sourceProvider)
    const sourceTransactionId = deriveCommissionSourceId({
      sourceTransactionId: row.sourceTransactionId,
      filename,
      rowNumber: index + 2,
      policyNumber: row.policyNumber,
      agentNpn: row.agentNpn,
      period: row.period,
    })
    const txnData = {
      type: row.transactionType ?? 'PAID',
      amount: row.amount,
      occurredAt: periodToDate(row.period),
      provider,
      sourceTransactionId,
    } as const
    await prisma.commissionTransaction.upsert({
      where: { provider_sourceTransactionId: { provider, sourceTransactionId } },
      create: { policyId: policy.id, agentId: agent.id, ...txnData },
      update: txnData,
    })

    const overrides = computeOverrides(allAgents, agent.id, row.amount, lookupPlan)
    for (const override of overrides) {
      await prisma.commissionRecord.upsert({
        where: {
          policyId_agentId_period_type_level: {
            policyId: policy.id,
            agentId: override.agentId,
            period: row.period,
            type: 'OVERRIDE',
            level: override.level,
          },
        },
        create: {
          policyId: policy.id,
          agentId: override.agentId,
          amount: override.amount,
          type: 'OVERRIDE',
          level: override.level,
          period: row.period,
          importBatchId: batch.id,
        },
        update: {
          amount: override.amount,
          importBatchId: batch.id,
        },
      })
    }

    successCount += 1
  }

  const status = deriveStatus(successCount, errors.length)
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status, rowErrors: errors },
  })

  return { batchId: batch.id, status, successCount, errors }
}
