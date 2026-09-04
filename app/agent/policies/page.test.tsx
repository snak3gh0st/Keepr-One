// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PoliciesPage from './page'

const state = vi.hoisted(() => ({ current: vi.fn(), history: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ name: 'Agent' }) } } }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'a', userId: 'u' }) }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: async () => ['a'] }))
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: async () => ({ copy: (pt: string) => pt, language: 'PT' }) }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ title, children }: any) => <div>{title}{children}</div> }))
vi.mock('@/lib/national-life/policy-directory', () => ({
  parsePolicyDirectoryFilters: (params: Record<string, string>) => ({
    view: params.view === 'history' ? 'history' : 'current',
    query: '', status: null, premiumKnown: false, sort: 'recent', page: 1,
  }),
  readCurrentPolicyDirectory: state.current,
  readHistoryPolicyDirectory: state.history,
}))
vi.mock('./PoliciesList', () => ({ PoliciesList: ({ items }: any) => <div>{items.map((p: any) => <span key={p.policyNumber}>{p.policyNumber}</span>)}</div> }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

const directory = (policyNumber: string, verified = true) => ({
  items: [{ policyNumber }],
  total: 1,
  page: 1,
  pageCount: 1,
  summary: { total: 1, inForce: 1, withPremium: 1, withoutPremium: 0, totalPremium: 100 },
  statusCounts: { INFORCE: 1 },
  filters: { view: 'current', query: '', status: null, premiumKnown: false, sort: 'recent', page: 1 },
  verified,
})

it('defaults to the reconciled current reader and exposes deliberate history navigation', async () => {
  state.current.mockResolvedValue(directory('CURRENT'))
  render(await PoliciesPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('CURRENT')).toBeVisible()
  expect(state.current).toHaveBeenCalled()
  expect(state.history).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Histórico' })).toHaveAttribute('href', '/agent/policies?view=history')
})

it('uses local history only for the explicitly labeled history view', async () => {
  state.history.mockResolvedValue({ ...directory('OLD'), filters: { ...directory('OLD').filters, view: 'history' } })
  render(await PoliciesPage({ searchParams: Promise.resolve({ view: 'history' }) }))
  expect(screen.getByText('Histórico de apólices')).toBeVisible()
  expect(screen.getByText('OLD')).toBeVisible()
  expect(state.current).not.toHaveBeenCalled()
  expect(state.history).toHaveBeenCalled()
})
