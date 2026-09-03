import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireFounderAccessForUser: vi.fn(),
  requireAgentOnboardingCompleteForUser: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}))
vi.mock('@/lib/founder-access', () => ({
  requireFounderAccessForUser: mocks.requireFounderAccessForUser,
}))
vi.mock('@/lib/agent-onboarding-gate', () => ({
  requireAgentOnboardingCompleteForUser: mocks.requireAgentOnboardingCompleteForUser,
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))

import {
  requireRole,
  requireRoleWithoutFounderAccess,
  requireRoleWithoutOnboarding,
} from './require-role'

describe('requireRole Founder boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers())
    mocks.requireFounderAccessForUser.mockResolvedValue({ state: 'TRIAL', hasAccess: true })
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-1', role: 'AGENT' },
      session: { id: 'session-1' },
    })
  })

  it('enforces Founder commercial access for an AGENT role', async () => {
    await expect(requireRole('ADMIN', 'AGENT')).resolves.toMatchObject({
      user: { id: 'user-1', role: 'AGENT' },
    })
    expect(mocks.requireFounderAccessForUser).toHaveBeenCalledWith('user-1')
    expect(mocks.requireAgentOnboardingCompleteForUser).toHaveBeenCalledWith('user-1')
  })

  it('does not apply the Founder product gate to ADMIN or CLIENT roles', async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'admin-1', role: 'ADMIN' },
      session: { id: 'session-admin' },
    })
    await requireRole('ADMIN')

    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'client-1', role: 'CLIENT' },
      session: { id: 'session-client' },
    })
    await requireRole('CLIENT')

    expect(mocks.requireFounderAccessForUser).not.toHaveBeenCalled()
    expect(mocks.requireAgentOnboardingCompleteForUser).not.toHaveBeenCalled()
  })

  it('bypasses only onboarding for the exact setup surface', async () => {
    await expect(requireRoleWithoutOnboarding('AGENT')).resolves.toBeTruthy()
    expect(mocks.requireFounderAccessForUser).toHaveBeenCalledWith('user-1')
    expect(mocks.requireAgentOnboardingCompleteForUser).not.toHaveBeenCalled()
  })

  it('provides a narrowly scoped bypass for routing to the payment-required page', async () => {
    await expect(requireRoleWithoutFounderAccess('AGENT')).resolves.toBeTruthy()
    expect(mocks.requireFounderAccessForUser).not.toHaveBeenCalled()
    expect(mocks.requireAgentOnboardingCompleteForUser).not.toHaveBeenCalled()
  })

  it('checks authentication and role before the product gate', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    await expect(requireRole('AGENT')).rejects.toThrow('Not authenticated')

    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'CLIENT' },
      session: { id: 'session-1' },
    })
    await expect(requireRole('AGENT')).rejects.toThrow('Forbidden: insufficient role')
    expect(mocks.requireFounderAccessForUser).not.toHaveBeenCalled()
  })

  it('rejects suspended users before applying product access gates', async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { id: 'user-1', role: 'AGENT', banned: true },
      session: { id: 'session-1' },
    })

    await expect(requireRole('AGENT')).rejects.toThrow('Forbidden: account access is suspended')
    expect(mocks.requireFounderAccessForUser).not.toHaveBeenCalled()
    expect(mocks.requireAgentOnboardingCompleteForUser).not.toHaveBeenCalled()
  })
})
