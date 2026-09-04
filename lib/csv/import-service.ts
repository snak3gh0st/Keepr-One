import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import { Prisma } from '@prisma/client'
import { nextReviewFrom } from '@/lib/annual-review'
import { parse } from 'csv-parse/sync'
import { prisma } from '@/lib/prisma'
import { computeOverrides } from '@/lib/commission'
import { REVIEWABLE_POLICY_STATUS } from '@/lib/policy-reviews'
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

// Content identities are independent of file name and ordering. An occurrence
// ordinal retains two genuinely identical payments within the same upload.
export function deriveCommissionSourceId(input: {
  sourceTransactionId?: string | null
  policyNumber: string
  agentNpn: string
  period: string
  amount: number
  transactionType?: string
  sourceProvider?: string
  occurrence?: number
}): string {
  if (input.sourceTransactionId?.trim()) return input.sourceTransactionId
  const signature = JSON.stringify([
    resolveImportProvider(input.sourceProvider), input.policyNumber.trim(),
    input.agentNpn.trim(), input.period.trim(), input.transactionType ?? 'PAID',
    new Decimal(input.amount).toString(),
  ])
  return `csv:v2:${createHash('sha256').update(signature).digest('hex')}:${input.occurrence ?? 1}`
}

export function realizedCommissionEffect(type: string, amount: number): number {
  if (type === 'EXPECTED') return 0
  if (type === 'CHARGEBACK') return -Math.abs(amount)
  if (type === 'PAID') return Math.abs(amount)
  return amount
}

// Concurrent uploads must not both apply a delta read from the same old ledger.
async function rowTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue
      throw error
    }
  }
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
  warnings?: string[]
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
    try {
      await rowTransaction(async (tx) => {
        const agent = await tx.agent.findUnique({ where: { npn: row.agentNpn } })
        if (!agent) {
          throw new Error('IMPORT_AGENT_NOT_FOUND')
        }
        const client = await tx.client.upsert({
          where: { id: `${agent.id}:${row.clientName}` },
          create: {
            id: `${agent.id}:${row.clientName}`,
            name: row.clientName,
            email: row.clientEmail || undefined,
            assignedAgentId: agent.id,
          },
          update: {},
        })
        const existingPolicy = await tx.policy.findUnique({
          where: { policyNumber: row.policyNumber },
          select: { status: true },
        })
        const statusChangedAt = shouldUpdateStatusChangedAt(existingPolicy, row.status)
          ? new Date()
          : undefined
        const lastPaymentDate = row.lastPaymentDate ? new Date(row.lastPaymentDate) : null
        const policy = await tx.policy.upsert({
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
            ...(row.effectiveDate !== undefined ? { effectiveDate: row.effectiveDate ? new Date(row.effectiveDate) : null } : {}),
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
        await tx.policySnapshot.upsert({
          where: { provider_externalId: { provider, externalId } },
          create: { policyId: policy.id, ...snapshotData },
          update: snapshotData,
        })

        // Seed an annual review for in-force policies so the yearly cadence starts
        // automatically. Idempotent — re-imports won't duplicate an open review.
        if (row.status === REVIEWABLE_POLICY_STATUS) {
          const openReview = await tx.policyReview.findFirst({ where: { policyId: policy.id, completedAt: null }, select: { id: true } })
          if (!openReview) await tx.policyReview.create({ data: {
            policyId: policy.id,
            dueAt: nextReviewFrom(row.effectiveDate ? new Date(row.effectiveDate) : null, new Date()),
          } })
        }
      })
      successCount += 1
    } catch {
      errors.push({ row: index + 2, message: 'Não foi possível importar esta linha. Nenhuma alteração desta linha foi salva.' })
    }
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

  const errors: { row: number; message: string }[] = []
  const occurrences = new Map<string, number>()
  const warnings: string[] = []
  let successCount = 0

  for (const [index, rawRow] of rows.entries()) {
    const parsed = CommissionRowSchema.safeParse(rawRow)
    if (!parsed.success) {
      errors.push({ row: index + 2, message: parsed.error.issues.map((issue) => issue.message).join('; ') })
      continue
    }
    const row = parsed.data
    const signature = deriveCommissionSourceId(row)
    const occurrence = (occurrences.get(signature) ?? 0) + 1
    occurrences.set(signature, occurrence)
    const sourceTransactionId = deriveCommissionSourceId({ ...row, occurrence })
    if (!row.sourceTransactionId?.trim() && warnings.length === 0) {
      warnings.push('Linhas sem ID de origem são identificadas pelo conteúdo. Um valor alterado será um novo lançamento; correções exigem o mesmo ID explícito da origem.')
    }
    try {
      await rowTransaction(async (tx) => {
        const agent = await tx.agent.findUnique({ where: { npn: row.agentNpn } })
        const policy = await tx.policy.findUnique({ where: { policyNumber: row.policyNumber } })
        if (!agent || !policy) throw new Error('IMPORT_REFERENCE_NOT_FOUND')
        const provider = resolveImportProvider(row.sourceProvider)
        const sourceKey = { provider_sourceTransactionId: { provider, sourceTransactionId } }
        const previous = await tx.commissionTransaction.findUnique({ where: sourceKey })
        const type = row.transactionType ?? 'PAID'
        const incomingEffect = realizedCommissionEffect(type, row.amount)
        const previousEffect = previous ? realizedCommissionEffect(previous.type, Number(previous.amount)) : 0
        const txnData = { policyId: policy.id, agentId: agent.id, type, amount: row.amount,
          occurredAt: periodToDate(row.period), provider, sourceTransactionId }
        await tx.commissionTransaction.upsert({ where: sourceKey, create: txnData, update: txnData })

        const allAgents = await tx.agent.findMany({ select: { id: true, parentAgentId: true, rank: true } })
        const plans = await tx.commissionPlan.findMany()
        const lookupPlan = (rank: string, level: number) => {
          const plan = plans.find((plan) => plan.rank === rank && plan.downlineLevel === level)
          return plan ? Number(plan.overridePercent) : null
        }
        const applyEffect = async (policyId: string, agentId: string, period: string, delta: number) => {
          if (delta === 0) return
          const increments = [{ agentId, type: 'DIRECT' as const, level: 0, amount: delta },
            ...computeOverrides(allAgents, agentId, delta, lookupPlan).map((override) => ({ ...override, type: 'OVERRIDE' as const }))]
          for (const increment of increments) {
            const key = { policyId, agentId: increment.agentId, period, type: increment.type, level: increment.level }
            await tx.commissionRecord.upsert({
              where: { policyId_agentId_period_type_level: key },
              create: { ...key, amount: increment.amount, importBatchId: batch.id },
              update: { amount: { increment: increment.amount }, importBatchId: batch.id },
            })
          }
        }
        const previousPeriod = previous?.occurredAt.toISOString().slice(0, 7)
        if (previous && (previous.policyId !== policy.id || previous.agentId !== agent.id || previousPeriod !== row.period)) {
          await applyEffect(previous.policyId, previous.agentId, previousPeriod!, -previousEffect)
          await applyEffect(policy.id, agent.id, row.period, incomingEffect)
        } else {
          await applyEffect(policy.id, agent.id, row.period, new Decimal(incomingEffect).minus(previousEffect).toNumber())
        }
      })
      successCount += 1
    } catch {
      errors.push({ row: index + 2, message: 'Não foi possível importar esta linha. Verifique agente e apólice e tente novamente. Nenhuma alteração desta linha foi salva.' })
    }
  }
  const status = deriveStatus(successCount, errors.length)
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status, rowErrors: errors } })
  return { batchId: batch.id, status, successCount, errors, warnings }
}
