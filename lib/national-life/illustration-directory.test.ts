import { describe, expect, it, vi } from 'vitest'
import {
  parseIllustrationDirectoryFilters,
  readIllustrationDirectory,
} from './illustration-directory'

function filters(overrides: Record<string, unknown> = {}) {
  return {
    query: '',
    document: null,
    sort: 'recent' as const,
    page: 1,
    ...overrides,
  }
}

describe('illustration directory filters', () => {
  it('defaults unsupported URL values safely', () => {
    expect(parseIllustrationDirectoryFilters({
      q: ['  Maria  ', 'ignored'],
      document: 'not-a-state',
      sort: 'random',
      page: '-1',
    })).toEqual(filters({ query: 'Maria' }))
  })

  it.each(['2junk', '2.9', '0', '-1', ''])('rejects non-positive or non-integer page %j', (page) => {
    expect(parseIllustrationDirectoryFilters({ page }).page).toBe(1)
  })
})

describe('readIllustrationDirectory', () => {
  it('makes record 101 reachable on page five with an agent-owned bounded query', async () => {
    const illustration = {
      count: vi.fn()
        .mockResolvedValueOnce(101)
        .mockResolvedValueOnce(100),
      findMany: vi.fn().mockResolvedValue([{ id: 'illustration-101' }]),
    }

    const result = await readIllustrationDirectory(
      { illustration } as never,
      'agent-1',
      filters({ page: 5 }),
    )

    expect(result).toMatchObject({ total: 101, page: 5, pageCount: 5 })
    expect(result.items).toEqual([{ id: 'illustration-101' }])
    expect(illustration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1' },
      skip: 100,
      take: 25,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
  })
})
