import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { parseDirectoryPage } from '@/lib/directory-page'

export const CLIENT_DIRECTORY_PAGE_SIZE = 25

const clientSorts = new Set<ClientDirectorySort>(['name-asc', 'name-desc'])

export type ClientDirectorySort = 'name-asc' | 'name-desc'

export type ClientDirectoryFilters = {
  query: string
  ownerId: string | null
  contactMissing: boolean
  sort: ClientDirectorySort
  page: number
}

export type ClientDirectoryItem = {
  id: string
  name: string
  email: string | null
  agentId: string
  agentName: string
}

export type ClientDirectoryOwner = { id: string; name: string }

export type ClientDirectoryResult = {
  items: ClientDirectoryItem[]
  total: number
  page: number
  pageCount: number
  summary: {
    total: number
    withEmail: number
    withoutEmail: number
    assignedAgents: number
  }
  filters: ClientDirectoryFilters
  owners: ClientDirectoryOwner[]
}

type SearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function parseClientDirectoryFilters(
  params: SearchParams,
  scopeAgentIds: readonly string[],
): ClientDirectoryFilters {
  const requestedOwner = firstParam(params.owner)
  const requestedSort = firstParam(params.sort) as ClientDirectorySort
  return {
    query: firstParam(params.q).trim().slice(0, 120),
    ownerId: scopeAgentIds.includes(requestedOwner) ? requestedOwner : null,
    contactMissing: firstParam(params.contact) === 'missing',
    sort: clientSorts.has(requestedSort) ? requestedSort : 'name-asc',
    page: parseDirectoryPage(firstParam(params.page)),
  }
}

/** Always starts with the explicit access scope, including after a user selects an owner. */
export function buildClientDirectoryWhere(
  scopeAgentIds: readonly string[],
  filters: ClientDirectoryFilters,
): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [
    { assignedAgentId: { in: [...scopeAgentIds] } },
  ]
  if (filters.ownerId) and.push({ assignedAgentId: filters.ownerId })
  if (filters.query) {
    and.push({
      OR: [
        { name: { contains: filters.query, mode: 'insensitive' } },
        { email: { contains: filters.query, mode: 'insensitive' } },
      ],
    })
  }
  if (filters.contactMissing) {
    and.push({ OR: [{ email: null }, { email: '' }] })
  }
  return { AND: and }
}

function contactableWhere(where: Prisma.ClientWhereInput): Prisma.ClientWhereInput {
  return {
    AND: [
      where,
      { email: { not: null } },
      { NOT: { email: '' } },
    ],
  }
}

export async function readClientDirectory(
  prisma: PrismaClient,
  scopeAgentIds: string[],
  filters: ClientDirectoryFilters,
): Promise<ClientDirectoryResult> {
  const where = buildClientDirectoryWhere(scopeAgentIds, filters)
  const [total, withEmail, ownerGroups, owners] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.count({ where: contactableWhere(where) }),
    prisma.client.groupBy({ by: ['assignedAgentId'], where, _count: { _all: true } }),
    prisma.agent.findMany({
      where: { id: { in: scopeAgentIds } },
      select: { id: true, user: { select: { name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
    }),
  ])
  const pageCount = Math.max(1, Math.ceil(total / CLIENT_DIRECTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const rows = await prisma.client.findMany({
    where,
    skip: (page - 1) * CLIENT_DIRECTORY_PAGE_SIZE,
    take: CLIENT_DIRECTORY_PAGE_SIZE,
    select: {
      id: true,
      name: true,
      email: true,
      assignedAgentId: true,
      assignedAgent: { select: { user: { select: { name: true } } } },
    },
    orderBy: filters.sort === 'name-desc'
      ? [{ name: 'desc' }, { id: 'desc' }]
      : [{ name: 'asc' }, { id: 'asc' }],
  })
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      agentId: row.assignedAgentId,
      agentName: row.assignedAgent.user.name,
    })),
    total,
    page,
    pageCount,
    summary: {
      total,
      withEmail,
      withoutEmail: total - withEmail,
      assignedAgents: ownerGroups.length,
    },
    filters: { ...filters, page },
    owners: owners.map((owner) => ({ id: owner.id, name: owner.user.name })),
  }
}
