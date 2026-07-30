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
  'NLDCommEarningAmt',
  'ESICommEarningAmt',
  'CommChargebackBalance',
  'DeductionBalances',
  'NLLifeAmount',
  'NLAnnuitiesAmount',
  'NLMutualFundsAmount',
  'LSWLifeAmount',
  'LSWAnnuitiesAmount',
  'VariableProductAmount',
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
      default:
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
    primaryDate: text(row, 'PayDate', 'PaymentDate', 'SubmitDate', 'ConcatParam'),
    label: text(row, 'FullName', 'AgentName', 'AgentNumber'),
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

export async function persistReportRows(
  input: PersistReportRowsInput,
): Promise<{ written: number }> {
  let written = 0

  for (const row of input.rows) {
    const data = {
      primaryDate: row.primaryDate,
      label: row.label,
      amounts: row.amounts as Prisma.InputJsonValue,
      raw: row.raw as Prisma.InputJsonValue,
      fetchedAt: input.fetchedAt,
    }

    await prisma.nationalLifeReportRow.upsert({
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
    written += 1
  }

  return { written }
}
