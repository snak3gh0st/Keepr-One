import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireAgentModule: vi.fn(),
  currentAgent: vi.fn(),
  agentScope: vi.fn(),
  policyFind: vi.fn(),
  inforceFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  caseFindMany: vi.fn(),
  requestRefresh: vi.fn(),
  revalidate: vi.fn(),
  language: { current: 'PT' as 'PT' | 'EN' },
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/require-agent-module', () => ({
  requireAgentModule: mocks.requireAgentModule,
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.currentAgent }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.agentScope }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    policy: { findUnique: mocks.policyFind },
    nationalLifeInforcePolicy: { findMany: mocks.inforceFindMany },
    nationalLifeReportRow: { findMany: mocks.reportFindMany },
    nationalLifeCaseSnapshot: { findMany: mocks.caseFindMany },
  },
}))
vi.mock('@/lib/national-life/policy-detail-command', () => ({
  requestNationalLifePolicyDetailRefresh: mocks.requestRefresh,
}))
vi.mock('@/lib/national-life/connector-command-service', () => ({
  issueConnectorCommand: vi.fn(), prismaConnectorCommandRepository: {},
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/storage', () => ({ buildStoredPath: vi.fn(), saveUploadedFile: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: mocks.language.current,
    copy: (pt: string, en: string) => mocks.language.current === 'PT' ? pt : en,
  }),
}))

import { refreshNationalLifePolicyDetail } from './actions'

describe('refreshNationalLifePolicyDetail action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.language.current = 'PT'
    mocks.requireRole.mockResolvedValue({ user: { role: 'AGENT' } })
    mocks.requireAgentModule.mockResolvedValue({ user: { id: 'user-1', role: 'AGENT' } })
    mocks.currentAgent.mockResolvedValue({ id: 'agent_1' })
    mocks.policyFind.mockResolvedValue({
      id: 'policy_1', agentId: 'agent_1', policyNumber: 'LS1473219', carrier: 'National Life',
    })
    mocks.agentScope.mockResolvedValue(['agent_1'])
    mocks.inforceFindMany.mockResolvedValue([{ raw: { source: 'inforce' } }])
    mocks.reportFindMany.mockResolvedValue([{ raw: { source: 'report' } }])
    mocks.caseFindMany.mockResolvedValue([{ raw: { source: 'case' } }])
    mocks.requestRefresh.mockResolvedValue({ commandId: 'cmd_1' })
  })

  it('searches every carrier-owned locator source for the policy detail path', async () => {
    mocks.requestRefresh.mockImplementationOnce(async (repository) => {
      await expect(repository.findCarrierRows({
        agentId: 'agent_1',
        deploymentScope: 'LOCAL_CONNECTOR',
        policyNumber: 'LS1473219',
      })).resolves.toEqual([
        { raw: { source: 'inforce' } },
        { raw: { source: 'report' } },
        { raw: { source: 'case' } },
      ])
      return { commandId: 'cmd_1' }
    })

    await refreshNationalLifePolicyDetail('policy_1')

    expect(mocks.reportFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: 'agent_1',
        gridKey: 'CLIENT_INTELLIGENCE',
        label: 'LS1473219',
      }),
    }))
    expect(mocks.caseFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: 'agent_1',
        policyNo: 'LS1473219',
      }),
    }))
  })

  it('issues a scoped command and returns only its safe identity', async () => {
    await expect(refreshNationalLifePolicyDetail('policy_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_1',
    })
    expect(mocks.requireAgentModule).toHaveBeenCalledWith('POLICIES')
    expect(mocks.requestRefresh).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agentScopeIds: ['agent_1'], policyId: 'policy_1',
    }))
    expect(mocks.agentScope).toHaveBeenCalledWith('agent_1')
    expect(mocks.revalidate).toHaveBeenCalledWith('/agent/policies/policy_1')
  })

  it('does not issue for a policy outside the agent hierarchy', async () => {
    mocks.policyFind.mockResolvedValueOnce({
      id: 'policy_2', agentId: 'agent_2', policyNumber: 'LS2', carrier: 'National Life',
    })
    await expect(refreshNationalLifePolicyDetail('policy_2')).resolves.toEqual({
      ok: false, message: 'Apólice fora da sua carteira.',
    })
    expect(mocks.requestRefresh).not.toHaveBeenCalled()
  })

  it('returns authorization errors in the selected English language', async () => {
    mocks.language.current = 'EN'
    mocks.policyFind.mockResolvedValueOnce({
      id: 'policy_2', agentId: 'agent_2', policyNumber: 'LS2', carrier: 'National Life',
    })

    await expect(refreshNationalLifePolicyDetail('policy_2')).resolves.toEqual({
      ok: false,
      message: 'Policy is outside your book.',
    })
  })
})
