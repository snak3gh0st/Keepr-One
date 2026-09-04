// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getCurrentSession: vi.fn(),
  getAgentScopeIds: vi.fn(),
  findUser: vi.fn(),
  findCase: vi.fn(),
  getPipelineForAgent: vi.fn(),
  findPipelineForAgent: vi.fn(),
  getCalendarConnectionForUser: vi.fn(),
  getCalendarEventsForCase: vi.fn(),
  workspaceProps: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.getAgentScopeIds }))
vi.mock('@/lib/i18n/server', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getServerI18n: async () => ({ language: 'PT', copy: (portuguese: string) => portuguese }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    insuranceCase: { findUnique: mocks.findCase },
  },
}))
vi.mock('@/lib/case-access', () => ({ canAccessCase: () => true }))
vi.mock('@/lib/decimal', () => ({ decimalToNumber: (value: number) => value }))
vi.mock('@/lib/crm', () => ({
  getPipelineForAgent: mocks.getPipelineForAgent,
  findPipelineForAgent: mocks.findPipelineForAgent,
}))
vi.mock('@/lib/calendar', () => ({
  getCalendarConnectionForUser: mocks.getCalendarConnectionForUser,
  getCalendarEventsForCase: mocks.getCalendarEventsForCase,
}))
vi.mock('@/components/calendar/server-adapter', () => ({
  mapDomainCalendarConnectionToUi: () => ({ connection: { status: 'DISCONNECTED' }, calendars: [] }),
  mapDomainCalendarEventToUi: vi.fn(),
}))
vi.mock('@/lib/application-addon/entitlement-prisma', () => ({
  getKBotApplicationEntitlement: vi.fn(async () => ({ entitled: false, subscriptionId: null, status: null })),
}))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('./CaseWorkspace', () => ({
  CaseWorkspace: ({ caseData }: { caseData: { crmStages: unknown[]; crmPipelineAvailable: boolean } }) => {
    mocks.workspaceProps(caseData)
    return <div data-testid="case-workspace">{caseData.crmPipelineAvailable ? 'configured' : 'not-configured'}</div>
  },
}))
vi.mock('next/navigation', () => ({ notFound: vi.fn() }))

import CaseDetailPage from './page'

const pipeline = {
  id: 'pipeline-1', agentId: 'agent-1',
  stages: [{ id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true, caseCount: 0 }],
}

const caseRecord = {
  id: 'case-1', assignedAgentId: 'agent-1', objective: null, productType: null, carrier: null,
  targetCoverage: null, monthlyBudget: null, needsAnalysis: null,
  prospect: { firstName: 'Ana', lastName: 'Cliente', email: null, phone: null, state: null, tobaccoStatus: null, dateOfBirth: null },
  assignedAgent: { userId: 'user-1', user: { name: 'Agente' } },
  illustrations: [], applications: [], timelineEvents: [], followUps: [], crmStage: null, policies: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.getCurrentSession.mockResolvedValue({
    user: { id: 'user-1', role: 'AGENT' },
    session: { id: 'session-1', impersonatedBy: null },
  })
  mocks.getAgentScopeIds.mockResolvedValue(['agent-1'])
  mocks.findUser.mockResolvedValue({ name: 'Agente', timeZone: 'America/New_York' })
  mocks.findCase.mockResolvedValue(caseRecord)
  mocks.getPipelineForAgent.mockResolvedValue(pipeline)
  mocks.findPipelineForAgent.mockResolvedValue(pipeline)
  mocks.getCalendarConnectionForUser.mockResolvedValue(null)
  mocks.getCalendarEventsForCase.mockResolvedValue([])
})

afterEach(() => cleanup())

describe('CaseDetailPage support preview', () => {
  it('renders a case without creating a missing CRM pipeline during preview', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })
    mocks.findPipelineForAgent.mockResolvedValue(null)

    render(await CaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }))

    expect(mocks.findPipelineForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.getPipelineForAgent).not.toHaveBeenCalled()
    expect(mocks.workspaceProps).toHaveBeenCalledWith(expect.objectContaining({
      crmStages: [], crmPipelineAvailable: false,
    }))
    expect(screen.getByRole('status')).toHaveTextContent('modo de suporte')
    expect(screen.getByTestId('case-workspace')).toHaveTextContent('not-configured')
  })

  it('uses the normal pipeline reader outside support preview', async () => {
    render(await CaseDetailPage({ params: Promise.resolve({ id: 'case-1' }) }))

    expect(mocks.getPipelineForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.findPipelineForAgent).not.toHaveBeenCalled()
    expect(mocks.workspaceProps).toHaveBeenCalledWith(expect.objectContaining({
      crmStages: pipeline.stages, crmPipelineAvailable: true,
    }))
  })
})
