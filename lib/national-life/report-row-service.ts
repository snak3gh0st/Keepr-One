import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import type { GridRow, NationalLifeGridKey } from './portal-grid-client'

export type ReportRow = {
  rowKey: string
  primaryDate: string | null
  label: string | null
  amounts: Record<string, string>
  raw: GridRow
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(row: GridRow, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string') {
      const trimmed = stripMarkup(value)
      if (trimmed.length > 0) {
        return trimmed
      }
      continue
    }
    if (typeof value === 'number') {
      return String(value)
    }
  }
  return null
}

/// Field names that carry money, per report. Several arrive wrapped in markup
/// (links to a statement), so the text is extracted before it is kept.
const AMOUNT_FIELDS = [
  // Statement level.
  'NLDCommEarningAmt',
  'ESICommEarningAmt',
  'CommChargebackBalance',
  'DeductionBalances',
  // Projected, by line of business.
  'NLLifeAmount',
  'NLAnnuitiesAmount',
  'NLMutualFundsAmount',
  'LSWLifeAmount',
  'LSWAnnuitiesAmount',
  'VariableProductAmount',
  // Per-policy earning detail — the actual commissioning figures.
  'GrossCommEarned',
  'PremiumAmt',
  'CommRate',
  'ParticipationPercentage',
  'RemainingBalance',
  // Chargeback statement — money that comes *out* of commission, and was
  // landing with an empty amounts object because none of these were listed.
  'GrossPay',
  'CommissionDollars',
  'CommissionsHeld',
  'StartingChargebackBalance',
  'EndingChargebackBalance',
] as const

function extractAmounts(row: GridRow): Record<string, string> {
  const amounts: Record<string, string> = {}
  for (const field of AMOUNT_FIELDS) {
    const value = text(row, field)
    if (value !== null) {
      amounts[field] = value
    }
  }
  return amounts
}

/// Identity per report. Falls back to a hash of the whole row so an unmapped
/// report still upserts deterministically instead of duplicating on every run.
export function deriveRowKey(gridKey: NationalLifeGridKey, row: GridRow): string {
  const parts: Array<string | null> = (() => {
    switch (gridKey) {
      case 'PAID_COMMISSIONS':
        return [text(row, 'GlobalId'), text(row, 'PayDate')]
      case 'PROJECTED_COMMISSIONS':
        return [text(row, 'AgentNumber'), text(row, 'PaymentDate')]
      // The carrier gives each of these a natural key. Using it instead of the
      // row hash means a value the carrier corrects updates the row in place
      // rather than arriving as a second, contradictory copy.
      case 'CLIENT_INTELLIGENCE':
        return [text(row, 'CaseDetailsId')]
      case 'CORRESPONDENCE':
        return [text(row, 'DocumentHandle')]
      case 'COMMISSIONS_PAYMENT_PORTAL':
        return [text(row, 'GlobalId')]
      case 'PIP_PENDING':
        return [text(row, 'PolicyNo'), text(row, 'AgentNumber')]
      default:
        // The per-statement earning detail repeats a policy across transactions,
        // so the transaction type and dates are part of its identity.
        if (row.PolicyNumber !== undefined && row.GrossCommEarned !== undefined) {
          return [
            text(row, 'CommissionStatementId'),
            text(row, 'PolicyNumber'),
            text(row, 'TransactionType'),
            text(row, 'PremiumEffDate'),
            text(row, 'ProcessDate'),
            text(row, 'GrossCommEarned'),
          ]
        }
        return []
    }
  })()

  const key = parts.filter((part): part is string => Boolean(part)).join('|')
  if (key) {
    return key
  }

  return createHash('sha256').update(JSON.stringify(row)).digest('hex').slice(0, 32)
}

export function toReportRow(gridKey: NationalLifeGridKey, row: GridRow): ReportRow {
  return {
    rowKey: deriveRowKey(gridKey, row),
    primaryDate: text(row, 'PayDate', 'PaymentDate', 'ProcessDate', 'SubmitDate', 'ConcatParam'),
    // Policy first: on the earning detail the policy is what identifies the row
    // to a reader, while the payee name repeats across hundreds of rows.
    label: text(row, 'PolicyNumber', 'FullName', 'AgentName', 'AgentNumber'),
    amounts: extractAmounts(row),
    raw: row,
  }
}

export function toReportRows(gridKey: NationalLifeGridKey, rows: GridRow[]): ReportRow[] {
  const byKey = new Map<string, ReportRow>()
  for (const row of rows) {
    const mapped = toReportRow(gridKey, row)
    byKey.set(mapped.rowKey, mapped)
  }
  return [...byKey.values()]
}

export type PersistReportRowsInput = {
  agentId: string
  deploymentScope: string
  gridKey: NationalLifeGridKey
  rows: ReportRow[]
  fetchedAt: Date
}

export type PruneStaleReportRowsInput = {
  agentId: string
  deploymentScope: string
  gridKeys: readonly string[]
  fetchedAt: Date
}

/// Drops rows the current run did not refresh.
///
/// Needed for two reasons: the carrier removes rows over time, and a change to
/// how `rowKey` is derived orphans everything written under the old scheme —
/// which is exactly what happened when transaction type was added to the
/// commission-detail key and 2992 stale rows were left behind next to the new
/// ones.
///
/// Only safe after a *complete* fetch. If pagination was truncated, un-fetched
/// rows are indistinguishable from deleted ones, so the caller must not prune.
export async function pruneStaleReportRows(
  input: PruneStaleReportRowsInput,
): Promise<{ deleted: number }> {
  const { count } = await prisma.nationalLifeReportRow.deleteMany({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      gridKey: { in: [...input.gridKeys] },
      fetchedAt: { lt: input.fetchedAt },
    },
  })
  return { deleted: count }
}

/// One round trip per chunk instead of per row; see persistInforcePolicies.
const UPSERT_CHUNK_SIZE = 500

export async function persistReportRows(
  input: PersistReportRowsInput,
): Promise<{ written: number }> {
  let written = 0

  for (let offset = 0; offset < input.rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = input.rows.slice(offset, offset + UPSERT_CHUNK_SIZE)
    await prisma.$transaction(chunk.map((row) => buildReportRowUpsert(input, row)))
    written += chunk.length
  }

  return { written }
}

function buildReportRowUpsert(input: PersistReportRowsInput, row: ReportRow) {
  const data = {
    primaryDate: row.primaryDate,
    label: row.label,
    amounts: row.amounts as Prisma.InputJsonValue,
    raw: row.raw as Prisma.InputJsonValue,
    fetchedAt: input.fetchedAt,
  }

  return prisma.nationalLifeReportRow.upsert({
    where: {
      agentId_deploymentScope_gridKey_rowKey: {
        agentId: input.agentId,
        deploymentScope: input.deploymentScope,
        gridKey: input.gridKey,
        rowKey: row.rowKey,
      },
    },
    create: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      gridKey: input.gridKey,
      rowKey: row.rowKey,
      ...data,
    },
    update: data,
  })
}
