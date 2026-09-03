import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
  },
}))

import {
  PlatformModuleAccessError,
  requireAgentModule,
} from './require-agent-module'

const AGENT_SESSION = {
  user: { id: 'user-1', role: 'AGENT' },
  session: { id: 'session-1' },
}

describe('requireAgentModule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue(AGENT_SESSION)
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: null,
      agencyInvitationsAccepted: [],
    })
  })

  it('preserves the action role boundary and bypasses module lookup for ADMIN', async () => {
    const adminSession = {
      user: { id: 'admin-1', role: 'ADMIN' },
      session: { id: 'admin-session' },
    }
    mocks.requireRole.mockResolvedValue(adminSession)

    await expect(requireAgentModule('CRM')).resolves.toBe(adminSession)

    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN', 'AGENT')
    expect(mocks.findAgent).not.toHaveBeenCalled()
  })

  it('keeps legacy agents unrestricted', async () => {
    await expect(requireAgentModule('COMMISSIONS')).resolves.toBe(AGENT_SESSION)
  })

  it('allows a granted module and the mandatory TODAY baseline', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['CRM'] },
      agencyInvitationsAccepted: [],
    })

    await expect(requireAgentModule('CRM')).resolves.toBe(AGENT_SESSION)
    await expect(requireAgentModule('TODAY')).resolves.toBe(AGENT_SESSION)
  })

  it('rejects a module omitted from managed access with a stable error', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY'] },
      agencyInvitationsAccepted: [],
    })

    const rejection = requireAgentModule('POLICIES')
    await expect(rejection).rejects.toBeInstanceOf(PlatformModuleAccessError)
    await expect(rejection).rejects.toMatchObject({
      code: 'PLATFORM_MODULE_DISABLED',
      module: 'POLICIES',
    })
  })

  it('gives a current accepted agency invitation precedence over admin grants', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY'] },
      agencyInvitationsAccepted: [{ id: 'invitation-1' }],
    })

    await expect(requireAgentModule('AGENCY')).resolves.toBe(AGENT_SESSION)
  })

  it('fails closed when an AGENT session has no Agent subject', async () => {
    mocks.findAgent.mockResolvedValue(null)

    await expect(requireAgentModule('CRM')).rejects.toThrow(
      'Signed-in user has no Agent record',
    )
  })
})
