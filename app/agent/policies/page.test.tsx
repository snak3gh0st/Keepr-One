// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PoliciesPage from './page'
const state = vi.hoisted(() => ({ projection: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ name: 'Agent' }) }, policy: { findMany: state.history } } }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'a', userId: 'u' }) }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: async () => ['a'] }))
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: async () => ({ copy: (pt: string) => pt, language: 'PT' }) }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ title, children }: any) => <div>{title}{children}</div> }))
vi.mock('@/lib/national-life/current-portfolio-prisma', () => ({ loadCurrentNationalLifePortfolio: state.projection }))
vi.mock('./PoliciesList', () => ({ PoliciesList: ({ policies }: any) => <div>{policies.map((p: any) => <span key={p.policyNumber}>{p.policyNumber}</span>)}</div> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const policy = (policyNumber: string) => ({ id: policyNumber, policyNumber, carrier: 'National Life', product: 'IUL', faceAmount: null, premium: 100, status: 'INFORCE', sourceStatus: 'Active', statusChangedAt: null, sourceProvider: 'NATIONAL_LIFE', clientName: 'Client', client: { name: 'Client' } })
it('defaults to the Today projection and exposes deliberate history navigation', async () => {
  state.projection.mockResolvedValue({ rows: [policy('CURRENT')], verified: true })
  state.history.mockResolvedValue([policy('OLD')])
  render(await PoliciesPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByText('CURRENT')).toBeVisible(); expect(screen.queryByText('OLD')).not.toBeInTheDocument()
  expect(state.projection).toHaveBeenCalled(); expect(state.history).not.toHaveBeenCalled()
  expect(screen.getByRole('link', { name: 'Histórico' })).toHaveAttribute('href', '/agent/policies?view=history')
})
it('loads accumulated local policies only for explicitly labeled history', async () => {
  state.history.mockResolvedValue([policy('OLD')])
  render(await PoliciesPage({ searchParams: Promise.resolve({ view: 'history' }) }))
  expect(screen.getByText('Histórico de apólices')).toBeVisible(); expect(screen.getByText('OLD')).toBeVisible()
  expect(state.projection).not.toHaveBeenCalled()
})
