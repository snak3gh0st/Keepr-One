import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  currentAgent: vi.fn(),
  agentScope: vi.fn(),
  policyFind: vi.fn(),
  requestRefresh: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.currentAgent }))
vi.mock('@/lib/agent-access', () => ({ getAgentScopeIds: mocks.agentScope }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    policy: { findUnique: mocks.policyFind },
    nationalLifeInforcePolicy: { findUnique: vi.fn() },
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

import { refreshNationalLifePolicyDetail } from './actions'

describe('refreshNationalLifePolicyDetail action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ user: { role: 'AGENT' } })
    mocks.currentAgent.mockResolvedValue({ id: 'agent_1' })
    mocks.policyFind.mockResolvedValue({
      id: 'policy_1', agentId: 'agent_1', policyNumber: 'LS1473219', carrier: 'National Life',
    })
    mocks.agentScope.mockResolvedValue(['agent_1'])
    mocks.requestRefresh.mockResolvedValue({ commandId: 'cmd_1' })
  })

  it('issues a scoped command and returns only its safe identity', async () => {
    await expect(refreshNationalLifePolicyDetail('policy_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_1',
    })
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
})
