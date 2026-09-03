import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn(),
  impersonateUser: vi.fn(),
  requireRole: vi.fn(),
  assertSameOriginAction: vi.fn(),
  userFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ auth: { api: { impersonateUser: mocks.impersonateUser } } }))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.assertSameOriginAction }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: vi.fn(async () => ({ copy: (pt: string) => pt })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    auditLog: { create: mocks.auditCreate, update: mocks.auditUpdate },
  },
}))

import { startManagedUserImpersonationAction } from './impersonation-actions'

const ADMIN_SESSION = { user: { id: 'cadmin1', role: 'ADMIN' }, session: { id: 'session-admin' } }
const TARGET = {
  id: 'cagent1',
  name: 'Agente Teste',
  role: 'AGENT',
  banned: false,
  agent: { id: 'agent-profile', status: 'ACTIVE' },
  client: null,
}

function validForm() {
  const form = new FormData()
  form.set('userId', TARGET.id)
  form.set('reason', 'Validar configuração da agenda')
  form.set('confirmed', 'yes')
  return form
}

describe('startManagedUserImpersonationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }))
    mocks.requireRole.mockResolvedValue(ADMIN_SESSION)
    mocks.userFindUnique.mockResolvedValue(TARGET)
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.impersonateUser.mockResolvedValue({ user: TARGET })
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT')
    })
  })

  it('starts a short audited preview through Better Auth and routes by server-owned role', async () => {
    await expect(startManagedUserImpersonationAction({ status: 'idle', message: '' }, validForm()))
      .rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.assertSameOriginAction).toHaveBeenCalledBefore(mocks.requireRole)
    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'cadmin1',
        entityId: TARGET.id,
        action: 'ADMIN_USER_PREVIEW_STARTED',
        after: expect.objectContaining({ mode: 'READ_ONLY', durationMinutes: 15 }),
      }),
    }))
    expect(mocks.impersonateUser).toHaveBeenCalledWith(expect.objectContaining({
      body: { userId: TARGET.id },
    }))
    expect(mocks.redirect).toHaveBeenCalledWith('/agent')
  })

  it('rejects staff targets and incomplete confirmations before creating a session', async () => {
    const incomplete = validForm()
    incomplete.delete('confirmed')
    await expect(startManagedUserImpersonationAction({ status: 'idle', message: '' }, incomplete))
      .resolves.toMatchObject({ status: 'error' })

    mocks.userFindUnique.mockResolvedValue({ ...TARGET, role: 'ADMIN', agent: null })
    await expect(startManagedUserImpersonationAction({ status: 'idle', message: '' }, validForm()))
      .resolves.toMatchObject({ status: 'error' })

    expect(mocks.impersonateUser).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('turns a failed auth handoff into an explicit failed audit record', async () => {
    mocks.impersonateUser.mockRejectedValue(new Error('auth failed'))

    const result = await startManagedUserImpersonationAction(
      { status: 'idle', message: '' },
      validForm(),
    )

    expect(result).toMatchObject({ status: 'error' })
    expect(mocks.auditUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'audit-1' },
      data: expect.objectContaining({ action: 'ADMIN_USER_PREVIEW_FAILED' }),
    }))
  })
})
