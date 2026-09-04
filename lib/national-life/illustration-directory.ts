import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { parseDirectoryPage } from '@/lib/directory-page'

export const ILLUSTRATION_DIRECTORY_PAGE_SIZE = 25

const illustrationSorts = new Set<IllustrationDirectorySort>(['recent', 'oldest'])

export type IllustrationDirectorySort = 'recent' | 'oldest'
export type IllustrationDocumentFilter = 'ready' | 'pending' | null

export type IllustrationDirectoryFilters = {
  query: string
  document: IllustrationDocumentFilter
  sort: IllustrationDirectorySort
  page: number
}

type SearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function parseIllustrationDirectoryFilters(
  params: SearchParams,
): IllustrationDirectoryFilters {
  const document = firstParam(params.document)
  const sort = firstParam(params.sort) as IllustrationDirectorySort
  return {
    query: firstParam(params.q).trim().slice(0, 120),
    document: document === 'ready' || document === 'pending' ? document : null,
    sort: illustrationSorts.has(sort) ? sort : 'recent',
    page: parseDirectoryPage(firstParam(params.page)),
  }
}

export function buildIllustrationDirectoryWhere(
  agentId: string,
  filters: IllustrationDirectoryFilters,
): Prisma.IllustrationWhereInput {
  const and: Prisma.IllustrationWhereInput[] = [{ agentId }]
  if (filters.query) {
    and.push({
      OR: [
        { insuredName: { contains: filters.query, mode: 'insensitive' } },
        { productName: { contains: filters.query, mode: 'insensitive' } },
        { client: { is: { name: { contains: filters.query, mode: 'insensitive' } } } },
      ],
    })
  }
  if (filters.document === 'ready') and.push({ documentFetchedAt: { not: null } })
  if (filters.document === 'pending') and.push({ documentFetchedAt: null })
  return and.length === 1 ? and[0] : { AND: and }
}

export async function readIllustrationDirectory(
  prisma: PrismaClient,
  agentId: string,
  filters: IllustrationDirectoryFilters,
) {
  const where = buildIllustrationDirectoryWhere(agentId, filters)
  const [total, ready] = await Promise.all([
    prisma.illustration.count({ where }),
    prisma.illustration.count({ where: { AND: [where, { documentFetchedAt: { not: null } }] } }),
  ])
  const pageCount = Math.max(1, Math.ceil(total / ILLUSTRATION_DIRECTORY_PAGE_SIZE))
  const page = Math.min(filters.page, pageCount)
  const items = await prisma.illustration.findMany({
    where,
    skip: (page - 1) * ILLUSTRATION_DIRECTORY_PAGE_SIZE,
    take: ILLUSTRATION_DIRECTORY_PAGE_SIZE,
    orderBy: filters.sort === 'oldest'
      ? [{ createdAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      createdAt: true,
      insuredName: true,
      faceAmount: true,
      premium: true,
      targetPremium: true,
      targetPremiumSource: true,
      productName: true,
      documentFetchedAt: true,
      documentMimeType: true,
      client: { select: { id: true, name: true } },
    },
  })
  return {
    items,
    total,
    page,
    pageCount,
    summary: { total, ready, pending: total - ready },
    filters: { ...filters, page },
  }
}
