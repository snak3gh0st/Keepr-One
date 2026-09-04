// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getCurrentSession: vi.fn(),
  getAgentScopeIds: vi.fn(),
  findUser: vi.fn(),
  findCases: vi.fn(),
  getPipelineForAgent: vi.fn(),
  findPipelineForAgent: vi.fn(),
  boardProps: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.getAgentScopeIds }))
vi.mock('@/lib/i18n/server', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getServerI18n: async () => ({ copy: (portuguese: string) => portuguese }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    insuranceCase: { findMany: mocks.findCases },
  },
}))
vi.mock('@/lib/crm', () => ({
  getPipelineForAgent: mocks.getPipelineForAgent,
  findPipelineForAgent: mocks.findPipelineForAgent,
}))
vi.mock('@/lib/decimal', () => ({ decimalToNumber: (value: number) => value }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/ErrorBanner', () => ({ ErrorBanner: ({ children }: { children: React.ReactNode }) => <div role="alert">{children}</div> }))
vi.mock('./CasesBoard', () => ({
  CasesBoard: (props: unknown) => {
    mocks.boardProps(props)
    return <div data-testid="cases-board" />
  },
}))

import CasesPage from './page'

const pipeline = {
  id: 'pipeline-1', agentId: 'agent-1',
  stages: [{ id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true, caseCount: 0 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.getCurrentSession.mockResolvedValue({
    user: { id: 'user-1', role: 'AGENT' },
    session: { id: 'session-1', impersonatedBy: null },
  })
  mocks.getAgentScopeIds.mockResolvedValue(['agent-1'])
  mocks.findUser.mockResolvedValue({ name: 'Ana' })
  mocks.findCases.mockResolvedValue([])
  mocks.getPipelineForAgent.mockResolvedValue(pipeline)
  mocks.findPipelineForAgent.mockResolvedValue(pipeline)
})

afterEach(() => cleanup())

describe('CasesPage support preview', () => {
  it('uses the non-mutating pipeline finder and explains a missing preview pipeline', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'user-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })
    mocks.findPipelineForAgent.mockResolvedValue(null)

    render(await CasesPage())

    expect(mocks.findPipelineForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.getPipelineForAgent).not.toHaveBeenCalled()
    expect(mocks.boardProps).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('modo de suporte')
  })

  it('keeps normal agent views on the lazy-initializing pipeline reader', async () => {
    render(await CasesPage())

    expect(mocks.getPipelineForAgent).toHaveBeenCalledWith('agent-1')
    expect(mocks.findPipelineForAgent).not.toHaveBeenCalled()
    expect(screen.getByTestId('cases-board')).toBeInTheDocument()
  })
})
