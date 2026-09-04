// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ClientsPage from './page'

const state = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ name: 'Agent' }) } } }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'agent-1', userId: 'user-1' }) }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: async () => ['agent-1'] }))
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: async () => ({ copy: (pt: string) => pt }) }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ModuleSummary', () => ({ ModuleSummary: () => null }))
vi.mock('@/components/CrmNavigation', () => ({ CrmNavigation: () => null }))
vi.mock('@/lib/crm/client-directory', () => ({
  parseClientDirectoryFilters: state.parse,
  readClientDirectory: state.read,
}))
vi.mock('./ClientsList', () => ({ ClientsList: ({ items }: any) => <div data-testid="client-count">{items.length}</div> }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('passes only the server page to ClientsList while retaining the authorized scope', async () => {
  state.parse.mockReturnValue({ query: '', ownerId: null, contactMissing: false, sort: 'name-asc', page: 2 })
  state.read.mockResolvedValue({
    items: Array.from({ length: 25 }, (_, index) => ({ id: String(index) })),
    total: 51,
    page: 2,
    pageCount: 3,
    summary: { total: 51, withEmail: 40, withoutEmail: 11, assignedAgents: 1 },
    filters: { query: '', ownerId: null, contactMissing: false, sort: 'name-asc', page: 2 },
    owners: [],
  })

  render(await ClientsPage({ searchParams: Promise.resolve({ page: '2' }) }))

  expect(screen.getByTestId('client-count')).toHaveTextContent('25')
  expect(state.read).toHaveBeenCalledWith(expect.anything(), ['agent-1'], expect.objectContaining({ page: 2 }))
})
