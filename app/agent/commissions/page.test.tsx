// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/// An empty statement is not an answer.
///
/// "You have no commissions" and "your commissions were collected but never
/// published" rendered the identical blank page. In production that turned a
/// pending sync into "as comissões sumiram": 27.036 collected rows sat in the
/// landing table while every agent saw nothing and was told nothing.
const state = vi.hoisted(() => ({
  carrierRows: [] as unknown[],
  landingCount: 0,
  connectorEnabled: true,
  listRows: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: async () => ({ name: 'Agent' }) },
    commissionRecord: { findMany: async () => [] },
    policy: { findMany: async () => [] },
    nationalLifeReportRow: { count: async () => state.landingCount },
  },
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'a', userId: 'u' }) }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: async () => ['a'] }))
// Interpolates like the real `localize`, so a message that forgets to pass its
// values fails here instead of shipping a literal `{count}` to an agent.
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: 'PT',
    copy: (pt: string, _en: string, values: Record<string, unknown> = {}) =>
      pt.replace(/\{(\w+)\}/g, (_, token: string) => String(values[token] ?? `{${token}}`)),
  }),
}))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: PropsWithChildren) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ title, children }: PropsWithChildren<{ title: string }>) => <div>{title}{children}</div> }))
vi.mock('@/components/ErrorBanner', () => ({ ErrorBanner: ({ children }: PropsWithChildren) => <div>{children}</div> }))
vi.mock('@/lib/national-life/published-report-reader', () => ({ readNationalLifeReports: async () => state.carrierRows }))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  getNationalLifeLocalConnectorConfig: () => ({ enabled: state.connectorEnabled }),
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'LOCAL_CONNECTOR',
}))
vi.mock('@/lib/national-life/commission-records', () => ({
  toCarrierCommissionRecords: (rows: unknown[]) => rows,
  preferCanonicalCarrierCommissionRows: (rows: unknown[]) => rows,
  auditVisibleCarrierCommissionRows: (rows: unknown[]) => ({ records: rows, rejectedCount: 0, duplicateCount: 0 }),
}))
vi.mock('./CommissionsList', () => ({
  CommissionsList: ({ byPeriod }: { byPeriod: Array<{ period: string; rows: unknown[] }> }) => {
    state.listRows = byPeriod.flatMap((group) => group.rows)
    return <div data-testid="list">{byPeriod.length ? 'COM LANÇAMENTOS' : 'SEM LANÇAMENTOS'}</div>
  },
}))

import CommissionsPage from './page'

const carrierRow = {
  id: 'r1', period: '2026-09', type: 'DIRECT', level: 0, amount: 10,
  policyNumber: 'P1', writingAgentNumber: '1', payeeName: 'Felipe',
  payeeNumber: '2', writingAgentAgency: 'A', writingAgentName: 'Felipe',
}

beforeEach(() => {
  state.carrierRows = []; state.landingCount = 0
  state.connectorEnabled = true; state.listRows = []
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows collected commissions when the carrier rows are published', async () => {
  state.carrierRows = [carrierRow]
  render(await CommissionsPage())
  expect(screen.getByTestId('list')).toHaveTextContent('COM LANÇAMENTOS')
  expect(screen.queryByRole('status')).toBeNull()
})

it('says the statement is waiting on a sync when rows were collected but never published', async () => {
  state.carrierRows = []
  state.landingCount = 21138
  render(await CommissionsPage())
  const notice = screen.getByRole('status')
  // The count is the point: it proves to the agent the money was not lost.
  expect(notice).toHaveTextContent('21.138')
  expect(notice).toHaveTextContent(/sincroniza/i)
})

it('stays an honest empty statement when nothing was ever collected', async () => {
  state.carrierRows = []
  state.landingCount = 0
  render(await CommissionsPage())
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByTestId('list')).toHaveTextContent('SEM LANÇAMENTOS')
})

it('does not consult the landing table when the connector is off', async () => {
  state.connectorEnabled = false
  state.landingCount = 21138
  render(await CommissionsPage())
  expect(screen.queryByRole('status')).toBeNull()
})
