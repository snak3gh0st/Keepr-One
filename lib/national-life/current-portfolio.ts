import type { NationalLifePortfolioMetricRow } from '../policy-metrics'
import { reconcileInforceRows, type InforceRow } from './portfolio-reconcile'
import type { PremiumEvolutionRow } from './premium-evolution'

export type StoredPortfolioRow = NationalLifePortfolioMetricRow & {
  agentId: string
  policyNumber: string
  id?: string
  carrier?: string
  product?: string
  faceAmount?: unknown
  statusChangedAt?: Date | null
  client?: { name: string } | null
}

export type CurrentPortfolioRow = NationalLifePortfolioMetricRow & {
  id: string | null
  policyNumber: string
  carrier: string
  product: string
  faceAmount: unknown
  statusChangedAt: Date | null
  clientName: string
  sourceProvider: 'NATIONAL_LIFE'
}

/** Membership and money come from ONE completed carrier export, never the
 * accumulated CRM history. History is retained, not silently marked canceled. */
export function currentPortfolioFromSnapshot(input: {
  rows: InforceRow[]
  stored: StoredPortfolioRow[]
  observedAt: Date
}) {
  const { policies } = reconcileInforceRows(input.rows)
  const stored = new Map(input.stored.map((row) => [row.policyNumber, row]))
  const membership = new Set(policies.map((row) => row.policyNumber))
  // A repeated policy may represent multiple agents in the export. Count its
  // AAP once, but do not silently choose between conflicting financial rows.
  const values = new Map<string, string>()
  const premiumEvolutionRows: PremiumEvolutionRow[] = []
  for (const row of input.rows) {
    const parsed = reconcileInforceRows([row]).policies[0]
    if (!parsed) continue
    premiumEvolutionRows.push({ policyNumber: parsed.policyNumber,
      issueDate: parsed.issueDate?.toISOString() ?? null, premium: parsed.premium,
      product: parsed.productName ?? 'Unknown' })
    const value = JSON.stringify([parsed.status, parsed.sourceStatus, parsed.premium])
    const previous = values.get(parsed.policyNumber)
    if (previous !== undefined && previous !== value) {
      throw new Error('NATIONAL_PORTFOLIO_SNAPSHOT_CONFLICT')
    }
    values.set(parsed.policyNumber, value)
  }
  return {
    rows: policies.map((row): CurrentPortfolioRow => ({
      id: stored.get(row.policyNumber)?.id ?? null,
      policyNumber: row.policyNumber,
      carrier: stored.get(row.policyNumber)?.carrier ?? 'National Life',
      product: row.productName ?? stored.get(row.policyNumber)?.product ?? '—',
      faceAmount: stored.get(row.policyNumber)?.faceAmount ?? null,
      statusChangedAt: row.statusChangedAt,
      clientName: row.insuredName ?? stored.get(row.policyNumber)?.client?.name ?? '—',
      sourceProvider: 'NATIONAL_LIFE' as const,
      clientId: stored.get(row.policyNumber)?.clientId ?? null,
      status: row.status,
      sourceStatus: row.sourceStatus,
      premium: row.premium,
      sourceUpdatedAt: input.observedAt,
    })),
    premiumEvolutionRows,
    observedAt: input.observedAt,
    historicalPolicies: input.stored.filter((row) => !membership.has(row.policyNumber)).length,
    statusCounts: [...Map.groupBy(policies, (row) => row.status)].map(([status, rows]) => ({ status, count: rows.length }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    productCounts: [...Map.groupBy(policies, (row) => row.productName ?? 'Unknown')]
      .map(([product, rows]) => ({ product, count: rows.length }))
      .sort((a, b) => b.count - a.count || a.product.localeCompare(b.product)),
  }
}

export function verifyPortfolioPages(input: {
  expectedRecordCount: number
  receivedRecordCount: number
  finalSequence: number
  truncated: boolean
  pages: { sequence: number; recordCount: number; records: unknown; observedAt: Date }[]
}) {
  const pages = [...input.pages].sort((a, b) => a.sequence - b.sequence)
  if (input.truncated || input.expectedRecordCount !== input.receivedRecordCount
    || pages.length !== input.finalSequence + 1
    || pages.some((page, index) => page.sequence !== index || !Array.isArray(page.records)
      || page.records.length !== page.recordCount)
    || pages.reduce((sum, page) => sum + page.recordCount, 0) !== input.receivedRecordCount) {
    throw new Error('NATIONAL_PORTFOLIO_SNAPSHOT_INCOMPLETE')
  }
  return pages
}
