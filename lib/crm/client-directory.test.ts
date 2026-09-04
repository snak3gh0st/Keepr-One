import { describe, expect, it, vi } from 'vitest'
import {
  buildClientDirectoryWhere,
  parseClientDirectoryFilters,
  readClientDirectory,
} from './client-directory'

function filters(overrides: Record<string, unknown> = {}) {
  return {
    query: '',
    ownerId: null,
    contactMissing: false,
    sort: 'name-asc' as const,
    page: 1,
    ...overrides,
  }
}

describe('client directory filters', () => {
  it('ignores a requested owner outside the authorized scope and normalizes unsafe values', () => {
    expect(parseClientDirectoryFilters({
      q: ['  Ana  ', 'ignored'],
      owner: 'outside-agent',
      contact: 'unknown',
      sort: 'DROP TABLE',
      page: '0',
    }, ['agent-1'])).toEqual(filters({ query: 'Ana' }))
  })

  it.each(['2junk', '2.9', '0', '-1', ''])('rejects non-positive or non-integer page %j', (page) => {
    expect(parseClientDirectoryFilters({ page }, ['agent-1']).page).toBe(1)
  })

  it('keeps the scope predicate even when a valid owner is selected', () => {
    const where = buildClientDirectoryWhere(['agent-1', 'agent-2'], filters({ ownerId: 'agent-2' }))
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { assignedAgentId: { in: ['agent-1', 'agent-2'] } },
        { assignedAgentId: 'agent-2' },
      ]),
    })
  })
})

describe('readClientDirectory', () => {
  it('filters and summarizes on the server, clamps the total, and fetches only page two', async () => {
    const client = {
      count: vi.fn()
        .mockResolvedValueOnce(51)
        .mockResolvedValueOnce(40),
      groupBy: vi.fn().mockResolvedValue([{ assignedAgentId: 'agent-1', _count: { _all: 51 } }]),
      findMany: vi.fn().mockResolvedValue([]),
    }
    const agent = { findMany: vi.fn().mockResolvedValue([{ id: 'agent-1', user: { name: 'Ana' } }]) }

    const result = await readClientDirectory(
      { client, agent } as never,
      ['agent-1'],
      filters({ query: 'Ana', contactMissing: true, page: 2 }),
    )

    expect(result).toMatchObject({ total: 51, page: 2, pageCount: 3 })
    expect(result.summary).toMatchObject({ total: 51, withEmail: 40, withoutEmail: 11, assignedAgents: 1 })
    expect(client.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([
        { assignedAgentId: { in: ['agent-1'] } },
        expect.objectContaining({ OR: expect.arrayContaining([
          expect.objectContaining({ name: expect.objectContaining({ contains: 'Ana' }) }),
          expect.objectContaining({ email: expect.objectContaining({ contains: 'Ana' }) }),
        ]) }),
        { OR: [{ email: null }, { email: '' }] },
      ]) }),
      skip: 25,
      take: 25,
    }))
    expect(agent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['agent-1'] } },
    }))
  })
})
