// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ProductionPage from './page'
const loader = vi.hoisted(() => vi.fn())
vi.mock('@/lib/national-life/admin-production', () => ({ loadAdminProduction: loader }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/require-role', () => ({ requireRole: async () => ({ user: { name: 'Admin' } }) }))
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: async () => ({ copy: (pt: string) => pt, language: 'PT' }) }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: () => <div /> }))
vi.mock('@/components/ContextPanel', () => ({ ContextPanel: ({ children }: any) => <div>{children}</div> }))
vi.mock('./ProductionTable', () => ({ ProductionTable: ({ rows }: any) => <div>{rows[0].commissionTotal}</div> }))
afterEach(cleanup)
it('renders the source reader result with explicit unknown-date and NPN coverage', async () => {
  loader.mockResolvedValue({ rows: [{ commissionTotal: 123 }], period: '2026-09', periods: ['2026-09'], source: 'NATIONAL_LIFE', coverage: { policiesWithoutEffectiveDate: 2, unmappedDirectRows: 3, unmappedDirectAmount: 50, rejectedRows: 4, missingWritingAgentRows: 1, missingPaymentDateRows: 2 } })
  render(await ProductionPage({ searchParams: Promise.resolve({ period: '2026-09' }) }))
  expect(screen.getByText('123')).toBeVisible()
  expect(screen.getByText(/Comissão direta: registros auditados/)).toBeVisible()
  expect(screen.getByText(/2 apólices sem data de vigência/)).toHaveTextContent('3 comissões diretas sem NPN correspondente')
  expect(screen.getByText(/data de vigência em UTC/)).toBeVisible()
  expect(loader).toHaveBeenCalledWith({}, '2026-09')
})
