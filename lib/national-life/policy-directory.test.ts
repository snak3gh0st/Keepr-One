import { describe, expect, it, vi } from 'vitest'
import {
  parsePolicyDirectoryFilters,
  readCurrentPolicyDirectory,
  readHistoryPolicyDirectory,
} from './policy-directory'

function filters(overrides: Record<string, unknown> = {}) {
  return {
    view: 'current' as const,
    query: '',
    status: null,
    premiumKnown: false,
    sort: 'recent' as const,
    page: 1,
    ...overrides,
  }
}

function currentRow(index: number) {
  return {
    id: index === 1 ? null : `policy-${index}`,
    sourceRecordId: `agent-1:policy:NL-${String(index).padStart(3, '0')}`,
    policyNumber: `NL-${String(index).padStart(3, '0')}`,
    carrier: 'National Life',
    product: 'IUL',
    faceAmount: 100_000,
    premium: index * 10,
    status: index % 2 ? 'INFORCE' : 'LAPSED',
    sourceStatus: index === 1 ? 'Pending Lapse' : 'Active',
    statusChangedAt: new Date(`2026-09-${String((index % 20) + 1).padStart(2, '0')}T00:00:00.000Z`),
    clientName: `Client ${index}`,
    sourceProvider: 'NATIONAL_LIFE' as const,
  }
}

describe('policy directory filters', () => {
  it('defaults invalid URL values to a bounded neutral current view', () => {
    expect(parsePolicyDirectoryFilters({
      view: 'anything',
      q: ['  Alice  ', 'ignored'],
      status: 'NOT_A_STATUS',
      premium: 'yes',
      sort: 'database-expression',
      page: '-8',
    })).toEqual(filters({ query: 'Alice' }))
  })

  it.each(['2junk', '2.9', '0', '-8', ''])('rejects non-positive or non-integer page %j', (page) => {
    expect(parsePolicyDirectoryFilters({ page }).page).toBe(1)
  })
})

describe('readCurrentPolicyDirectory', () => {
  it('uses the reconciled portfolio projection and returns only page two while keeping whole-result summaries', async () => {
    const loadPortfolio = vi.fn().mockResolvedValue({
      rows: Array.from({ length: 51 }, (_, index) => currentRow(index + 1)),
      verified: true,
    })

    const result = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-1'],
      filters({ page: 2 }),
      loadPortfolio,
    )

    expect(loadPortfolio).toHaveBeenCalledWith({}, ['agent-1'])
    expect(result).toMatchObject({ total: 51, page: 2, pageCount: 3, verified: true })
    expect(result.items).toHaveLength(25)
    expect(result.summary.total).toBe(51)
    expect(result.statusCounts.PENDING_LAPSE).toBe(1)
    expect(result.items).not.toHaveLength(51)
  })

  it('keeps source-only carrier rows in the current projection and filters Pending Lapse by source status', async () => {
    const result = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-1'],
      filters({ status: 'PENDING_LAPSE' }),
      vi.fn().mockResolvedValue({ rows: [currentRow(1), currentRow(2)], verified: true }),
    )

    expect(result.items).toEqual([expect.objectContaining({
      policyNumber: 'NL-001',
      linkedPolicyId: null,
      sourceStatus: 'Pending Lapse',
    })])
  })

  it('keeps source-only rows stable across page boundaries regardless of loader order', async () => {
    const earlierRows = Array.from({ length: 24 }, (_, index) => ({
      ...currentRow(index + 2),
      statusChangedAt: new Date('2026-09-02T00:00:00.000Z'),
    }))
    const sourceOnly = (sourceRecordId: string) => ({
      ...currentRow(1),
      sourceRecordId,
      policyNumber: 'NL-SOURCE-ONLY',
      clientName: 'Same source client',
      statusChangedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const sourceA = sourceOnly('agent-A:policy:NL-SOURCE-ONLY')
    const sourceB = sourceOnly('agent-a:policy:NL-SOURCE-ONLY')

    const firstPage = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-a', 'agent-b'],
      filters(),
      vi.fn().mockResolvedValue({ rows: [...earlierRows, sourceB, sourceA], verified: true }),
    )
    const repeatedFirstPage = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-a', 'agent-b'],
      filters(),
      vi.fn().mockResolvedValue({ rows: [sourceA, sourceB, ...[...earlierRows].reverse()], verified: true }),
    )
    const secondPage = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-a', 'agent-b'],
      filters({ page: 2 }),
      vi.fn().mockResolvedValue({ rows: [...earlierRows, sourceB, sourceA], verified: true }),
    )
    const repeatedSecondPage = await readCurrentPolicyDirectory(
      {} as never,
      ['agent-a', 'agent-b'],
      filters({ page: 2 }),
      vi.fn().mockResolvedValue({ rows: [sourceA, sourceB, ...[...earlierRows].reverse()], verified: true }),
    )

    expect(firstPage.items).toHaveLength(25)
    expect(firstPage.items).toEqual(repeatedFirstPage.items)
    expect(secondPage.items).toEqual(repeatedSecondPage.items)
    expect(firstPage.items.map((item) => item.stableKey)).toEqual(repeatedFirstPage.items.map((item) => item.stableKey))
    expect(secondPage.items.map((item) => item.stableKey)).toEqual(repeatedSecondPage.items.map((item) => item.stableKey))
    expect(firstPage.items.at(-1)).toMatchObject({ linkedPolicyId: null, stableKey: sourceA.sourceRecordId })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0]).toMatchObject({ linkedPolicyId: null, stableKey: sourceB.sourceRecordId })
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.stableKey)).size).toBe(26)
  })
})

describe('readHistoryPolicyDirectory', () => {
  it('counts before fetching and applies page-two skip/take to explicit history only', async () => {
    const policy = {
      count: vi.fn().mockResolvedValue(51),
      aggregate: vi.fn().mockResolvedValue({ _sum: { premium: 1234 } }),
      groupBy: vi.fn().mockResolvedValue([{ status: 'INFORCE', sourceStatus: 'Active', _count: { _all: 51 } }]),
      findMany: vi.fn().mockResolvedValue([]),
    }

    const result = await readHistoryPolicyDirectory(
      { policy } as never,
      ['agent-1'],
      filters({ view: 'history', page: 2 }),
    )

    expect(result).toMatchObject({ total: 51, page: 2, pageCount: 3 })
    expect(policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([
        { agentId: { in: ['agent-1'] } },
      ]) }),
      skip: 25,
      take: 25,
    }))
    expect(policy.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['status', 'sourceStatus'],
    }))
  })

  it('does not advertise whitespace-padded Pending Lapse history rows that the exact status query cannot return', async () => {
    const policy = {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { premium: null } }),
      groupBy: vi.fn().mockResolvedValue([
        { status: 'INFORCE', sourceStatus: ' Pending Lapse ', _count: { _all: 1 } },
      ]),
      findMany: vi.fn().mockResolvedValue([]),
    }

    const result = await readHistoryPolicyDirectory(
      { policy } as never,
      ['agent-1'],
      filters({ view: 'history' }),
    )

    expect(result.statusCounts.PENDING_LAPSE).toBeUndefined()

    await readHistoryPolicyDirectory(
      { policy } as never,
      ['agent-1'],
      filters({ view: 'history', status: 'PENDING_LAPSE' }),
    )
    expect(policy.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([
        { sourceStatus: { equals: 'Pending Lapse', mode: 'insensitive' } },
      ]) }),
    }))
  })
})
