import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSessionCookie: vi.fn(),
  getSession: vi.fn(),
  findAgent: vi.fn(),
}))

vi.mock('better-auth/cookies', () => ({ getSessionCookie: mocks.getSessionCookie }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
  },
}))

import { proxy } from './proxy'

function request(path: string, method = 'GET') {
  return new NextRequest(`http://localhost:3000${path}`, { method })
}

describe('middleware administrative user preview boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionCookie.mockReturnValue('session-token')
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'session-1', impersonatedBy: null },
    })
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: null,
      agencyInvitationsAccepted: [],
    })
  })

  it('keeps the anonymous page redirect without breaking public auth endpoints', async () => {
    mocks.getSessionCookie.mockReturnValue(null)

    const protectedResponse = await proxy(request('/agent'))
    const authResponse = await proxy(request('/api/auth/sign-in/email', 'POST'))

    expect(protectedResponse.status).toBe(307)
    expect(protectedResponse.headers.get('location')).toBe('http://localhost:3000/login')
    expect(authResponse.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('uses the dedicated login for anonymous admin pages and preserves the destination', async () => {
    mocks.getSessionCookie.mockReturnValue(null)

    const response = await proxy(request('/admin/users?query=ana&page=2'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/admin/login?next=%2Fadmin%2Fusers%3Fquery%3Dana%26page%3D2',
    )
  })

  it('keeps the admin login itself public without changing user-portal redirects', async () => {
    mocks.getSessionCookie.mockReturnValue(null)

    const adminLogin = await proxy(request('/admin/login'))
    const clientPortal = await proxy(request('/client'))
    const onboarding = await proxy(request('/onboarding'))

    expect(adminLogin.headers.get('x-middleware-next')).toBe('1')
    expect(clientPortal.headers.get('location')).toBe('http://localhost:3000/login')
    expect(onboarding.headers.get('location')).toBe('http://localhost:3000/login')
  })

  it('allows reads but rejects writes while an admin is viewing a user', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })

    const readResponse = await proxy(request('/agent/calendar'))
    const writeResponse = await proxy(request('/api/auth/update-user', 'POST'))

    expect(readResponse.headers.get('x-middleware-next')).toBe('1')
    expect(writeResponse.status).toBe(403)
    await expect(writeResponse.json()).resolves.toMatchObject({ error: 'READ_ONLY_USER_PREVIEW' })
  })

  it('also blocks product write-through GET callbacks during a preview', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })

    const oauth = await proxy(request('/api/agent/integrations/google-calendar/authorize'))
    const billing = await proxy(request('/api/billing/complete?session_id=cs_test_123'))

    expect(oauth.status).toBe(403)
    expect(billing.status).toBe(403)
  })

  it.each([
    '/api/auth/verify-email?token=verification-token',
    '/api/auth/callback/google?code=oauth-code',
    '/api/auth/delete-user/callback?token=delete-token',
  ])('blocks the mutating auth GET endpoint %s during a preview', async (path) => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })

    const response = await proxy(request(path))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'READ_ONLY_USER_PREVIEW' })
  })

  it('does not interfere with writes from a normal authenticated session', async () => {
    const response = await proxy(request('/agent/settings', 'POST'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it('cannot be bypassed by replaying a Server Action against a public route', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })

    const response = await proxy(request('/privacy', 'POST'))

    expect(response.status).toBe(403)
  })

  it('keeps the dedicated return endpoint available during a preview', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'agent-1', role: 'AGENT' },
      session: { id: 'preview-1', impersonatedBy: 'admin-1' },
    })

    const response = await proxy(request('/api/admin/user-preview/stop', 'POST'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('keeps all mapped modules available to legacy agents', async () => {
    const response = await proxy(request('/agent/commissions'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.findAgent).toHaveBeenCalledWith({
      where: { userId: 'agent-1' },
      select: {
        adminProvisionedAccess: {
          select: { modules: true },
        },
        agencyInvitationsAccepted: {
          where: { status: 'ACCEPTED', isCurrentCommercial: true },
          take: 1,
          select: { id: true },
        },
      },
    })
  })

  it('gives a current accepted agency invitation precedence over admin module grants', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY'] },
      agencyInvitationsAccepted: [{ id: 'invitation-1' }],
    })

    const response = await proxy(request('/agent/commissions'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('allows a granted module and always repairs the TODAY baseline', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['CRM'] },
    })

    const crmResponse = await proxy(request('/agent/cases/new'))
    const todayResponse = await proxy(request('/agent?module=blocked'))

    expect(crmResponse.headers.get('x-middleware-next')).toBe('1')
    expect(todayResponse.headers.get('x-middleware-next')).toBe('1')
  })

  it('redirects a safe page read when its module is not granted', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY', 'CRM'] },
    })

    const response = await proxy(request('/agent/commissions?period=month'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/agent?module=blocked',
    )
  })

  it('returns JSON 403 for a disabled API module', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY'] },
    })

    const response = await proxy(request('/api/agent/calendar/events'))

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'PLATFORM_MODULE_DISABLED',
      message: 'This module is not enabled for the current account.',
      module: 'CALENDAR',
    })
  })

  it('returns JSON 403 for an unsafe request to a disabled page module', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['TODAY'] },
    })

    const response = await proxy(request('/agent/cases/case-1', 'POST'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'PLATFORM_MODULE_DISABLED',
      module: 'CRM',
    })
  })

  it.each(['/agent/settings', '/api/billing/checkout', '/api/auth/update-user'])(
    'keeps the operational route %s outside module lookup',
    async (path) => {
      await proxy(request(path))

      expect(mocks.findAgent).not.toHaveBeenCalled()
    },
  )

  it('does not apply agent module grants to an administrator', async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
      session: { id: 'session-1', impersonatedBy: null },
    })

    const response = await proxy(request('/agent/commissions'))

    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.findAgent).not.toHaveBeenCalled()
  })
})
