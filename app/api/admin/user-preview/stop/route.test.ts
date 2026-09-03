import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  stopImpersonating: vi.fn(),
  signOut: vi.fn(),
  userFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
  assertSameOriginAction: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
      stopImpersonating: mocks.stopImpersonating,
      signOut: mocks.signOut,
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst },
    auditLog: {
      create: mocks.auditCreate,
      update: mocks.auditUpdate,
    },
  },
}))

vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.assertSameOriginAction,
}))

import { POST } from './route'

const ADMIN_ID = 'cadmin1'
const TARGET_ID = 'cagent1'

function request() {
  return new Request('https://app.keeprone.com/api/admin/user-preview/stop', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=preview-session; better-auth.admin_session=admin-session',
      host: 'app.keeprone.com',
      origin: 'https://app.keeprone.com',
    },
  })
}

function previewSession(role: 'AGENT' | 'CLIENT' | 'ADMIN' = 'AGENT') {
  return {
    user: { id: TARGET_ID, role },
    session: {
      id: 'preview-session-id',
      impersonatedBy: ADMIN_ID,
    },
  }
}

describe('POST /api/admin/user-preview/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(previewSession())
    mocks.userFindFirst.mockResolvedValue({ id: ADMIN_ID })
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })

    const headers = new Headers()
    headers.append(
      'set-cookie',
      '__Secure-better-auth.session_token=restored-admin; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    headers.append(
      'set-cookie',
      '__Secure-better-auth.admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    mocks.stopImpersonating.mockResolvedValue({ headers })

    const signOutHeaders = new Headers()
    signOutHeaders.append(
      'set-cookie',
      '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    mocks.signOut.mockResolvedValue({ headers: signOutHeaders })
  })

  it('validates same-origin before reading or mutating authentication state', async () => {
    mocks.assertSameOriginAction.mockImplementationOnce(() => {
      throw new Error('Invalid action origin')
    })

    await expect(POST(request())).rejects.toThrow('Invalid action origin')

    expect(mocks.assertSameOriginAction).toHaveBeenCalledWith({
      origin: 'https://app.keeprone.com',
      host: 'app.keeprone.com',
      forwardedHost: null,
      forwardedProto: null,
    })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.stopImpersonating).not.toHaveBeenCalled()
  })

  it.each([
    ['missing session', null],
    [
      'ordinary session',
      {
        user: { id: TARGET_ID, role: 'AGENT' },
        session: { id: 'ordinary-session', impersonatedBy: null },
      },
    ],
    ['administrative target', previewSession('ADMIN')],
  ])('rejects %s without consulting the claimed administrator', async (_label, session) => {
    mocks.getSession.mockResolvedValueOnce(session)

    const response = await POST(request())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ message: 'No active user preview.' })
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.stopImpersonating).not.toHaveBeenCalled()
  })

  it('fails closed when the original administrator is no longer eligible', async () => {
    mocks.userFindFirst.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(mocks.userFindFirst).toHaveBeenCalledWith({
      where: { id: ADMIN_ID, role: 'ADMIN', banned: false },
      select: { id: true },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      restored: false,
      redirectTo: '/login?preview=ended',
    })
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.stopImpersonating).not.toHaveBeenCalled()
    expect(mocks.signOut).toHaveBeenCalledWith(expect.objectContaining({
      returnHeaders: true,
    }))
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringContaining('better-auth.admin_session=;'),
      expect.stringContaining('__Secure-better-auth.admin_session=;'),
      expect.stringContaining('better-auth.session_token=;'),
      expect.stringContaining('__Secure-better-auth.session_token=;'),
    ]))
  })

  it('restores the official Better Auth session, forwards every cookie and records the real actor', async () => {
    const incomingRequest = request()

    const response = await POST(incomingRequest)

    expect(mocks.getSession).toHaveBeenCalledWith({ headers: incomingRequest.headers })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: ADMIN_ID,
        action: 'ADMIN_USER_PREVIEW_ENDED',
        entity: 'User',
        entityId: TARGET_ID,
        before: { targetRole: 'AGENT', mode: 'READ_ONLY' },
        after: { restoredAdminSession: true },
      },
      select: { id: true },
    })
    expect(mocks.stopImpersonating).toHaveBeenCalledWith({
      headers: incomingRequest.headers,
      returnHeaders: true,
    })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toEqual({
      ok: true,
      redirectTo: `/admin/users/${TARGET_ID}`,
    })

    const setCookies = response.headers.getSetCookie()
    expect(setCookies).toContainEqual(expect.stringContaining('session_token=restored-admin'))
    expect(setCookies).toContainEqual(expect.stringContaining('admin_session=; Max-Age=0'))
    expect(setCookies).toContainEqual(expect.stringContaining('better-auth.admin_session=;'))
    expect(setCookies).toContainEqual(expect.stringContaining('__Secure-better-auth.admin_session=;'))
    expect(JSON.stringify(payload)).not.toContain('restored-admin')
  })

  it('does not let an audit outage prevent restoration of the administrator session', async () => {
    mocks.auditCreate.mockRejectedValueOnce(new Error('audit database unavailable'))

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      redirectTo: `/admin/users/${TARGET_ID}`,
    })
    expect(mocks.stopImpersonating).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringContaining('session_token=restored-admin'),
    )
  })

  it('records a failed restore without returning stale authentication cookies', async () => {
    mocks.stopImpersonating.mockRejectedValueOnce(new Error('admin session expired'))

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      restored: false,
      redirectTo: '/login?preview=ended',
    })
    expect(mocks.signOut).toHaveBeenCalledWith(expect.objectContaining({
      returnHeaders: true,
    }))
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringContaining('better-auth.admin_session=;'),
      expect.stringContaining('__Secure-better-auth.admin_session=;'),
      expect.stringContaining('better-auth.session_token=;'),
      expect.stringContaining('__Secure-better-auth.session_token=;'),
    ]))
    expect(mocks.auditUpdate).toHaveBeenCalledWith({
      where: { id: 'audit-1' },
      data: {
        action: 'ADMIN_USER_PREVIEW_STOP_FAILED',
        after: { restoredAdminSession: false, fallback: 'SIGNED_OUT' },
      },
    })
  })

  it('still clears every authentication cookie when emergency sign-out itself fails', async () => {
    mocks.stopImpersonating.mockRejectedValueOnce(new Error('admin session expired'))
    mocks.signOut.mockRejectedValueOnce(new Error('session storage unavailable'))

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      restored: false,
      redirectTo: '/login?preview=ended',
    })
    expect(response.headers.getSetCookie()).toEqual(expect.arrayContaining([
      expect.stringContaining('better-auth.admin_session=;'),
      expect.stringContaining('__Secure-better-auth.admin_session=;'),
      expect.stringContaining('better-auth.session_token=;'),
      expect.stringContaining('__Secure-better-auth.session_token=;'),
      expect.stringContaining('better-auth.dont_remember=;'),
      expect.stringContaining('__Secure-better-auth.dont_remember=;'),
      expect.stringContaining('better-auth.session_data=;'),
      expect.stringContaining('__Secure-better-auth.session_data=;'),
    ]))
  })
})
