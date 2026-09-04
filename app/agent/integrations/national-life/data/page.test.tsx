import { renderToStaticMarkup } from 'react-dom/server'
import type { PropsWithChildren } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import NationalLifeDataPage from './page'

type InforceRenderRow = { policyNumber: string }

const state = vi.hoisted(() => ({
  userFindUnique: vi.fn().mockResolvedValue({ name: 'Agent' }),
  caseFindMany: vi.fn().mockResolvedValue([]),
  inforceFindMany: vi.fn().mockResolvedValue([
    {
      id: 'inforce-owned-account',
      policyNumber: 'OWNED-DIFFERENT-CARRIER-NUMBER',
      insuredClientName: 'Owned client',
      ownerClientName: null,
      productName: 'IUL',
      policyStatus: 'Active',
      policyIssueDate: null,
      servicingAgencyName: null,
    },
    {
      id: 'inforce-owned-account-without-number',
      policyNumber: 'OWNED-WITHOUT-CARRIER-NUMBER',
      insuredClientName: 'Another owned client',
      ownerClientName: null,
      productName: 'Term',
      policyStatus: 'Active',
      policyIssueDate: null,
      servicingAgencyName: null,
    },
  ]),
  reportFindMany: vi.fn().mockResolvedValue([]),
  syncRunFindFirst: vi.fn().mockResolvedValue(null),
  policyFindMany: vi.fn().mockResolvedValue([]),
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a>,
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'a1', userId: 'u1' }) }))
vi.mock('@/lib/agent-access', () => ({
  getCurrentAgentAccess: async () => ({ scopeAgentIds: ['a1'], canViewAgencyNationalLife: false }),
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  getNationalLifeLocalConnectorConfig: () => ({ enabled: true }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: state.userFindUnique },
    nationalLifeCaseSnapshot: { findMany: state.caseFindMany },
    nationalLifeInforcePolicy: { findMany: state.inforceFindMany },
    nationalLifeReportRow: { findMany: state.reportFindMany },
    nationalLifeSyncRun: { findFirst: state.syncRunFindFirst },
    policy: { findMany: state.policyFindMany },
  },
}))
vi.mock('@/lib/national-life/client-intelligence', () => ({
  buildClientActionQueue: () => [],
  toClientServiceEvents: () => [],
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({ copy: (portuguese: string) => portuguese, language: 'PT' }),
}))
vi.mock('@/lib/i18n/config', () => ({ localeFor: () => 'pt-BR' }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: PropsWithChildren) => <main>{children}</main> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ children }: PropsWithChildren) => <header>{children}</header> }))
vi.mock('@/components/ContextPanel', () => ({ ContextPanel: ({ children }: PropsWithChildren) => <aside>{children}</aside> }))
vi.mock('@/components/ModuleSummary', () => ({ ModuleSummary: () => null }))
vi.mock('@/components/ErrorBanner', () => ({ ErrorBanner: ({ children }: PropsWithChildren) => <div>{children}</div> }))
vi.mock('./NationalLifeActionQueue', () => ({ NationalLifeActionQueue: () => null }))
vi.mock('./NationalLifeDataTabs', () => ({
  NationalLifeDataTabs: ({ inforce }: { inforce: readonly InforceRenderRow[] }) => (
    <div>{inforce.map((row) => <span key={row.policyNumber}>{row.policyNumber}</span>)}</div>
  ),
}))

afterEach(() => vi.clearAllMocks())

it('shows the paired account partition without filtering carrier producer numbers', async () => {
  const markup = renderToStaticMarkup(await NationalLifeDataPage())

  expect(markup).toContain('OWNED-DIFFERENT-CARRIER-NUMBER')
  expect(markup).toContain('OWNED-WITHOUT-CARRIER-NUMBER')

  const caseWhere = state.caseFindMany.mock.calls[0]?.[0].where
  const inforceWhere = state.inforceFindMany.mock.calls[0]?.[0].where
  expect(caseWhere).toEqual({ agentId: { in: ['a1'] }, deploymentScope: 'LOCAL_CONNECTOR' })
  expect(inforceWhere).toEqual({ agentId: { in: ['a1'] }, deploymentScope: 'LOCAL_CONNECTOR' })
  expect(caseWhere).not.toHaveProperty('writingAgentNumber')
  expect(inforceWhere).not.toHaveProperty('agentNumber')
})
