import 'server-only'

import type { PolicyStatus, Prisma, PrismaClient } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal'
import { parseDirectoryPage } from '@/lib/directory-page'
import { loadCurrentNationalLifePortfolio } from './current-portfolio-prisma'
import { CANONICAL_PENDING_LAPSE_STATUS, isCanonicalPendingLapse } from './pending-lapse'

export const POLICY_DIRECTORY_PAGE_SIZE = 25

export const POLICY_DIRECTORY_STATUSES = [
  'INFORCE',
  'PENDING_LAPSE',
  'APPROVED',
  'PENDING',
  'LAPSED',
  'CANCELLED',
] as const

const policyStatuses = new Set<string>(POLICY_DIRECTORY_STATUSES)
const policySorts = new Set<PolicyDirectorySort>([
  'recent',
  'client-asc',
  'client-desc',
  'premium-desc',
  'premium-asc',
])

export type PolicyDirectorySort =
  | 'recent'
  | 'client-asc'
  | 'client-desc'
  | 'premium-desc'
  | 'premium-asc'

export type PolicyDirectoryFilters = {
  view: 'current' | 'history'
  query: string
  status: (typeof POLICY_DIRECTORY_STATUSES)[number] | null
  premiumKnown: boolean
  sort: PolicyDirectorySort
  page: number
}

export type PolicyDirectoryItem = {
  stableKey: string
  linkedPolicyId: string | null
  policyNumber: string
  carrier: string
  product: string
  faceAmount: string | null
  premium: string | null
  status: string
  sourceStatus: string | null
  statusChangedAt: string | null
  clientName: string
}

export type PolicyDirectorySummary = {
  total: number
  inForce: number
  withPremium: number
  withoutPremium: number
  totalPremium: number
}

export type PolicyDirectoryResult = {
  items: PolicyDirectoryItem[]
  total: number
  page: number
  pageCount: number
  summary: PolicyDirectorySummary
  statusCounts: Record<string, number>
  filters: PolicyDirectoryFilters
  verified: boolean
}

type SearchParams = Record<string, string | string[] | undefined>

type CurrentPortfolioSourceRow = {
  id: string | null
  sourceRecordId: string
  policyNumber: string
  carrier: string
  product: string
  faceAmount: unknown
  premium: unknown
  status: string
  sourceStatus: string | null
  statusChangedAt: Date | null
  clientName: string
}

type CurrentPortfolioLoader = (
  prisma: PrismaClient,
  agentIds: string[],
) => Promise<{ rows: CurrentPortfolioSourceRow[]; verified: boolean }>

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function parsePolicyDirectoryFilters(params: SearchParams): PolicyDirectoryFilters {
  const requestedStatus = firstParam(params.status)
  const requestedSort = firstParam(params.sort) as PolicyDirectorySort
  return {
    view: firstParam(params.view) === 'history' ? 'history' : 'current',
    query: firstParam(params.q).trim().slice(0, 120),
    status: policyStatuses.has(requestedStatus)
      ? requestedStatus as PolicyDirectoryFilters['status']
      : null,
    premiumKnown: firstParam(params.premium) === 'known',
    sort: policySorts.has(requestedSort) ? requestedSort : 'recent',
    page: parseDirectoryPage(firstParam(params.page)),
  }
}

function numericPremium(value: string | null): number {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDirectoryItem(row: CurrentPortfolioSourceRow): PolicyDirectoryItem {
  return {
    stableKey: row.id ?? row.sourceRecordId,
    linkedPolicyId: row.id,
    policyNumber: row.policyNumber,
    carrier: row.carrier,
    product: row.product,
    faceAmount: row.faceAmount == null ? null : decimalToNumber(row.faceAmount).toFixed(2),
    premium: row.premium == null ? null : decimalToNumber(row.premium).toFixed(2),
    status: row.status,
    sourceStatus: row.sourceStatus,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    clientName: row.clientName,
  }
}

function matchesDirectoryQuery(row: PolicyDirectoryItem, query: string): boolean {
  if (!query) return true
  const haystack = [row.clientName, row.policyNumber, row.carrier, row.product]
    .join(' ')
    .toLocaleLowerCase('en-US')
  return haystack.includes(query.toLocaleLowerCase('en-US'))
}

function matchesStatus(row: PolicyDirectoryItem, status: PolicyDirectoryFilters['status']): boolean {
  if (!status) return true
  if (status === 'PENDING_LAPSE') return isCanonicalPendingLapse(row.sourceStatus)
  return row.status === status
}

function sortDirectoryRows(rows: readonly PolicyDirectoryItem[], sort: PolicyDirectorySort): PolicyDirectoryItem[] {
  const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })
  return [...rows].sort((left, right) => {
    if (sort === 'client-asc' || sort === 'client-desc') {
      const byClient = collator.compare(left.clientName, right.clientName)
      if (byClient !== 0) return sort === 'client-asc' ? byClient : -byClient
    }
    if (sort === 'premium-asc' || sort === 'premium-desc') {
      const byPremium = numericPremium(left.premium) - numericPremium(right.premium)
      if (byPremium !== 0) return sort === 'premium-asc' ? byPremium : -byPremium
    }
    if (sort === 'recent') {
      const byStatusChange = (right.statusChangedAt ? new Date(right.statusChangedAt).getTime() : 0)
        - (left.statusChangedAt ? new Date(left.statusChangedAt).getTime() : 0)
      if (byStatusChange !== 0) return byStatusChange
    }
    const byPolicyNumber = collator.compare(left.policyNumber, right.policyNumber)
    if (byPolicyNumber !== 0) return byPolicyNumber
    if (left.stableKey === right.stableKey) return 0
    return left.stableKey < right.stableKey ? -1 : 1
  })
}

function summarize(rows: readonly PolicyDirectoryItem[]): PolicyDirectorySummary {
  const withPremium = rows.filter((row) => row.premium !== null)
  return {
    total: rows.length,
    inForce: rows.filter((row) => row.status === 'INFORCE').length,
    withPremium: withPremium.length,
    withoutPremium: rows.length - withPremium.length,
    totalPremium: withPremium.reduce((total, row) => total + numericPremium(row.premium), 0),
  }
}

function countStatuses(rows: readonly PolicyDirectoryItem[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.status] = (result[row.status] ?? 0) + 1
    if (isCanonicalPendingLapse(row.sourceStatus)) result.PENDING_LAPSE = (result.PENDING_LAPSE ?? 0) + 1
  }
  return result
}

function pageResult(
  rows: readonly PolicyDirectoryItem[],
  filters: PolicyDirectoryFilters,
  verified: boolean,
): PolicyDirectoryResult {
  const filteredBySearchAndPremium = rows.filter((row) =>
    matchesDirectoryQuery(row, filters.query) && (!filters.premiumKnown || row.premium !== null),
  )
  const filtered = sortDirectoryRows(
    filteredBySearchAndPremium.filter((row) => matchesStatus(row, filters.status)),
    filters.sort,
  )
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / POLICY_DIRECTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const start = (page - 1) * POLICY_DIRECTORY_PAGE_SIZE
  return {
    items: filtered.slice(start, start + POLICY_DIRECTORY_PAGE_SIZE),
    total,
    page,
    pageCount,
    summary: summarize(filtered),
    statusCounts: countStatuses(filteredBySearchAndPremium),
    filters: { ...filters, page },
    verified,
  }
}

/**
 * Current policies must stay sourced from the completed National Life portfolio
 * projection. The projection can require a whole export for reconciliation, but
 * this reader keeps that full set on the server and sends only one directory page.
 */
export async function readCurrentPolicyDirectory(
  prisma: PrismaClient,
  agentIds: string[],
  filters: PolicyDirectoryFilters,
  loadPortfolio: CurrentPortfolioLoader = loadCurrentNationalLifePortfolio,
): Promise<PolicyDirectoryResult> {
  const portfolio = await loadPortfolio(prisma, agentIds)
  return pageResult(portfolio.rows.map(toDirectoryItem), filters, portfolio.verified)
}

function historyPremiumKnownWhere(): Prisma.PolicyWhereInput {
  return {
    premium: { not: null },
    OR: [
      { sourceProvider: null },
      { premium: { gt: 0 } },
    ],
  }
}

function statusWhere(status: PolicyDirectoryFilters['status']): Prisma.PolicyWhereInput | null {
  if (!status) return null
  if (status === 'PENDING_LAPSE') {
    return { sourceStatus: { equals: CANONICAL_PENDING_LAPSE_STATUS, mode: 'insensitive' } }
  }
  return { status: status as PolicyStatus }
}

function historyBaseWhere(
  agentIds: string[],
  filters: PolicyDirectoryFilters,
): Prisma.PolicyWhereInput {
  const and: Prisma.PolicyWhereInput[] = [{ agentId: { in: agentIds } }]
  if (filters.query) {
    and.push({
      OR: [
        { policyNumber: { contains: filters.query, mode: 'insensitive' } },
        { carrier: { contains: filters.query, mode: 'insensitive' } },
        { product: { contains: filters.query, mode: 'insensitive' } },
        { client: { is: { name: { contains: filters.query, mode: 'insensitive' } } } },
      ],
    })
  }
  if (filters.premiumKnown) and.push(historyPremiumKnownWhere())
  return { AND: and }
}

function withHistoryStatus(
  base: Prisma.PolicyWhereInput,
  status: PolicyDirectoryFilters['status'],
): Prisma.PolicyWhereInput {
  const filter = statusWhere(status)
  return filter ? { AND: [base, filter] } : base
}

function historyOrderBy(sort: PolicyDirectorySort): Prisma.PolicyOrderByWithRelationInput[] {
  if (sort === 'client-asc') return [{ client: { name: 'asc' } }, { id: 'asc' }]
  if (sort === 'client-desc') return [{ client: { name: 'desc' } }, { id: 'desc' }]
  if (sort === 'premium-desc') return [{ premium: 'desc' }, { id: 'asc' }]
  if (sort === 'premium-asc') return [{ premium: 'asc' }, { id: 'asc' }]
  return [
    { statusChangedAt: { sort: 'desc', nulls: 'last' } },
    { createdAt: 'desc' },
    { id: 'desc' },
  ]
}

function combineWhere(...inputs: Prisma.PolicyWhereInput[]): Prisma.PolicyWhereInput {
  return { AND: inputs }
}

/** Historical records remain an explicit local-history view and are paged in SQL. */
export async function readHistoryPolicyDirectory(
  prisma: PrismaClient,
  agentIds: string[],
  filters: PolicyDirectoryFilters,
): Promise<PolicyDirectoryResult> {
  const baseWhere = historyBaseWhere(agentIds, filters)
  const where = withHistoryStatus(baseWhere, filters.status)
  const knownPremiumWhere = combineWhere(where, historyPremiumKnownWhere())
  const inForceWhere = combineWhere(where, { status: 'INFORCE' })

  const [total, premiumAggregate, inForce, withPremium, statusGroups] = await Promise.all([
    prisma.policy.count({ where }),
    prisma.policy.aggregate({ where, _sum: { premium: true } }),
    prisma.policy.count({ where: inForceWhere }),
    prisma.policy.count({ where: knownPremiumWhere }),
    prisma.policy.groupBy({
      by: ['status', 'sourceStatus'],
      where: baseWhere,
      _count: { _all: true },
    }),
  ])
  const pageCount = Math.max(1, Math.ceil(total / POLICY_DIRECTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const rows = await prisma.policy.findMany({
    where,
    skip: (page - 1) * POLICY_DIRECTORY_PAGE_SIZE,
    take: POLICY_DIRECTORY_PAGE_SIZE,
    orderBy: historyOrderBy(filters.sort),
    select: {
      id: true,
      policyNumber: true,
      carrier: true,
      product: true,
      faceAmount: true,
      premium: true,
      status: true,
      sourceStatus: true,
      statusChangedAt: true,
      client: { select: { name: true } },
    },
  })
  const statusCounts: Record<string, number> = {}
  for (const group of statusGroups) {
    const count = group._count._all
    statusCounts[group.status] = (statusCounts[group.status] ?? 0) + count
    if (isCanonicalPendingLapse(group.sourceStatus)) {
      statusCounts.PENDING_LAPSE = (statusCounts.PENDING_LAPSE ?? 0) + count
    }
  }
  const premiumSum = premiumAggregate._sum.premium
  return {
    items: rows.map((row) => ({
      stableKey: row.id,
      linkedPolicyId: row.id,
      policyNumber: row.policyNumber,
      carrier: row.carrier,
      product: row.product,
      faceAmount: row.faceAmount == null ? null : decimalToNumber(row.faceAmount).toFixed(2),
      premium: row.premium == null ? null : decimalToNumber(row.premium).toFixed(2),
      status: row.status,
      sourceStatus: row.sourceStatus,
      statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
      clientName: row.client?.name ?? '—',
    })),
    total,
    page,
    pageCount,
    summary: {
      total,
      inForce,
      withPremium,
      withoutPremium: total - withPremium,
      totalPremium: premiumSum == null ? 0 : decimalToNumber(premiumSum),
    },
    statusCounts,
    filters: { ...filters, page },
    verified: true,
  }
}
