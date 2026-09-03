import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  assertSameOriginAction: vi.fn(),
  requireRole: vi.fn(),
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  requestPasswordReset: vi.fn(),
  sendVerificationEmail: vi.fn(),
  revokeUserSessions: vi.fn(),
  revokeUserSession: vi.fn(),
  sessionFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  userCount: vi.fn(),
  agentUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  txUserFindUnique: vi.fn(),
  txUserUpdateMany: vi.fn(),
  txAgentUpdateMany: vi.fn(),
  txAdminProvisionedAccessUpdateMany: vi.fn(),
  txClientUpdateMany: vi.fn(),
  txAgencyUpdateMany: vi.fn(),
  txAuditCreate: vi.fn(),
}))

const transactionClient = {
  user: {
    findUnique: mocks.txUserFindUnique,
    updateMany: mocks.txUserUpdateMany,
  },
  agent: { updateMany: mocks.txAgentUpdateMany },
  adminProvisionedAccess: { updateMany: mocks.txAdminProvisionedAccessUpdateMany },
  client: { updateMany: mocks.txClientUpdateMany },
  agency: { updateMany: mocks.txAgencyUpdateMany },
  auditLog: { create: mocks.txAuditCreate },
}

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.assertSameOriginAction,
}))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: vi.fn(async () => ({
    language: 'PT',
    copy: (portuguese: string) => portuguese,
  })),
}))
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      banUser: mocks.banUser,
      unbanUser: mocks.unbanUser,
      requestPasswordReset: mocks.requestPasswordReset,
      sendVerificationEmail: mocks.sendVerificationEmail,
      revokeUserSessions: mocks.revokeUserSessions,
      revokeUserSession: mocks.revokeUserSession,
    },
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      count: mocks.userCount,
    },
    agent: { update: mocks.agentUpdate },
    auditLog: { create: mocks.auditCreate },
    session: { findMany: mocks.sessionFindMany },
    $transaction: mocks.transaction,
  },
}))

import {
  requestManagedUserPasswordResetAction,
  resendManagedUserVerificationAction,
  revokeManagedUserSessionsAction,
  updateManagedUserAccessAction,
  updateManagedUserProfileAction,
} from './actions'

const INITIAL_ADMIN_USER_ACTION_STATE = { status: 'idle' as const, message: '' }

const ADMIN_ID = 'cm0h7x7qf0000abcde1234567'
const TARGET_ID = 'clh3amg6u0000n0v5xk4l6p8q'
const AGENT_ID = 'ck12345678901234567890123'
const UPDATED_AT = new Date('2026-09-01T16:00:00.000Z')
const AGENT_UPDATED_AT = new Date('2026-09-01T15:00:00.000Z')
const AGENCY_UPDATED_AT = new Date('2026-09-01T14:00:00.000Z')
const ACCESS_UPDATED_AT = new Date('2026-09-01T13:00:00.000Z')
const REQUEST_HEADERS = new Headers({
  origin: 'https://app.keeprone.com',
  host: 'app.keeprone.com',
  cookie: 'better-auth.session_token=admin-secret',
})

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

function profileForm(overrides: Record<string, string> = {}): FormData {
  return form({
    userId: TARGET_ID,
    expectedUpdatedAt: UPDATED_AT.toISOString(),
    expectedAgentUpdatedAt: AGENT_UPDATED_AT.toISOString(),
    expectedAgencyUpdatedAt: AGENCY_UPDATED_AT.toISOString(),
    expectedClientUpdatedAt: '',
    name: '  Maria da Silva  ',
    language: 'EN',
    timeZone: 'America/New_York',
    phone: '+1 (305) 555-0100',
    npn: '  987654  ',
    rank: 'AGENCY_OWNER',
    agencyName: '  North Star Advisory  ',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    ...overrides,
  })
}

function accessForm(intent: 'SUSPEND' | 'RESTORE', reason = 'Solicitação da gerência') {
  return form({ userId: TARGET_ID, intent, reason })
}

function resetForm(userId = TARGET_ID) {
  return form({ userId })
}

function currentManagedProfile() {
  return {
    id: TARGET_ID,
    name: 'Maria Silva',
    language: 'PT',
    timeZone: 'America/Chicago',
    updatedAt: UPDATED_AT,
    agent: {
      id: AGENT_ID,
      phone: '3055550199',
      npn: '123456',
      rank: 'AGENCY_OWNER',
      updatedAt: AGENT_UPDATED_AT,
      adminProvisionedAccess: {
        id: 'access-1',
        updatedAt: ACCESS_UPDATED_AT,
        individualRank: 'MANAGER',
        platformSubscription: { plan: 'AGENCY' },
      },
      agencyMemberships: [{
        agency: { id: 'agency-1', name: 'North Star', updatedAt: AGENCY_UPDATED_AT },
      }],
    },
    client: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(REQUEST_HEADERS)
  mocks.requireRole.mockResolvedValue({ user: { id: ADMIN_ID, name: 'Admin Keepr', role: 'ADMIN' } })
  mocks.banUser.mockResolvedValue({ user: { id: TARGET_ID, banned: true } })
  mocks.unbanUser.mockResolvedValue({ user: { id: TARGET_ID, banned: false } })
  mocks.requestPasswordReset.mockResolvedValue({ status: true })
  mocks.sendVerificationEmail.mockResolvedValue({ status: true })
  mocks.revokeUserSessions.mockResolvedValue({ success: true })
  mocks.revokeUserSession.mockResolvedValue({ success: true })
  mocks.sessionFindMany.mockResolvedValue([])
  mocks.userCount.mockResolvedValue(1)
  mocks.agentUpdate.mockResolvedValue({ id: AGENT_ID })
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
  mocks.txUserFindUnique.mockResolvedValue(currentManagedProfile())
  mocks.txUserUpdateMany.mockResolvedValue({ count: 1 })
  mocks.txAgentUpdateMany.mockResolvedValue({ count: 1 })
  mocks.txAdminProvisionedAccessUpdateMany.mockResolvedValue({ count: 1 })
  mocks.txClientUpdateMany.mockResolvedValue({ count: 1 })
  mocks.txAgencyUpdateMany.mockResolvedValue({ count: 1 })
  mocks.txAuditCreate.mockResolvedValue({ id: 'audit-profile' })
  mocks.transaction.mockImplementation(async (input: unknown) => {
    if (typeof input === 'function') {
      return (input as (tx: typeof transactionClient) => unknown)(transactionClient)
    }
    return Promise.all(input as Promise<unknown>[])
  })
})

describe('updateManagedUserProfileAction', () => {
  it('requires an ADMIN session after validating the same-origin request', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden: insufficient role'))

    await expect(
      updateManagedUserProfileAction(INITIAL_ADMIN_USER_ACTION_STATE, profileForm()),
    ).rejects.toThrow('Forbidden: insufficient role')

    expect(mocks.assertSameOriginAction).toHaveBeenCalledWith({
      origin: 'https://app.keeprone.com',
      host: 'app.keeprone.com',
      forwardedHost: null,
      forwardedProto: null,
    })
    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('normalizes the edit, writes the owned records and audits before/after as the admin', async () => {
    const result = await updateManagedUserProfileAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      profileForm(),
    )

    expect(result).toEqual({ status: 'success', message: 'Dados do usuário atualizados.' })
    expect(mocks.txUserUpdateMany).toHaveBeenCalledWith({
      where: { id: TARGET_ID, updatedAt: UPDATED_AT },
      data: {
        name: 'Maria da Silva',
        language: 'EN',
        timeZone: 'America/New_York',
      },
    })
    expect(mocks.txAgentUpdateMany).toHaveBeenCalledWith({
      where: { id: AGENT_ID, updatedAt: AGENT_UPDATED_AT },
      data: {
        phone: '+13055550100',
        npn: '987654',
        rank: 'AGENCY_OWNER',
      },
    })
    expect(mocks.txAgencyUpdateMany).toHaveBeenCalledWith({
      where: { id: 'agency-1', updatedAt: AGENCY_UPDATED_AT },
      data: { name: 'North Star Advisory' },
    })
    expect(mocks.txAdminProvisionedAccessUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ADMIN_ID,
        action: 'ADMIN_USER_PROFILE_UPDATED',
        entity: 'User',
        entityId: TARGET_ID,
        before: expect.objectContaining({
          name: 'Maria Silva',
          phone: '3055550199',
          npn: '123456',
          agencyName: 'North Star',
        }),
        after: expect.objectContaining({
          name: 'Maria da Silva',
          phone: '+13055550100',
          npn: '987654',
          agencyName: 'North Star Advisory',
        }),
      }),
    })
    expect(mocks.revokeUserSessions).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { userId: TARGET_ID },
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/users')
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/users/${TARGET_ID}`)
  })

  it('never demotes an agency owner while editing the rest of the profile', async () => {
    const result = await updateManagedUserProfileAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      profileForm({ rank: 'DIRECTOR' }),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'O cargo de responsável pela agência é protegido e não pode ser alterado.',
    })
    expect(mocks.txAgentUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txAuditCreate).not.toHaveBeenCalled()
  })

  it('keeps the stored individual rank synchronized when an individual agent changes rank', async () => {
    mocks.txUserFindUnique.mockResolvedValue({
      ...currentManagedProfile(),
      agent: {
        ...currentManagedProfile().agent,
        rank: 'MANAGER',
        adminProvisionedAccess: {
          id: 'access-1',
          updatedAt: ACCESS_UPDATED_AT,
          individualRank: 'MANAGER',
          platformSubscription: { plan: 'AGENT_INDIVIDUAL' },
        },
        agencyMemberships: [],
      },
    })

    const result = await updateManagedUserProfileAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      profileForm({
        expectedAgencyUpdatedAt: '',
        rank: 'DIRECTOR',
        agencyName: '',
      }),
    )

    expect(result).toEqual({ status: 'success', message: 'Dados do usuário atualizados.' })
    expect(mocks.txAgentUpdateMany).toHaveBeenCalledWith({
      where: { id: AGENT_ID, updatedAt: AGENT_UPDATED_AT },
      data: {
        phone: '+13055550100',
        npn: '987654',
        rank: 'DIRECTOR',
      },
    })
    expect(mocks.txAdminProvisionedAccessUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'access-1',
        updatedAt: ACCESS_UPDATED_AT,
        platformSubscription: { plan: 'AGENT_INDIVIDUAL' },
      },
      data: {
        individualRank: 'DIRECTOR',
        updatedById: ADMIN_ID,
      },
    })
  })

  it('rejects the profile edit if the individual-plan record changed concurrently', async () => {
    mocks.txUserFindUnique.mockResolvedValue({
      ...currentManagedProfile(),
      agent: {
        ...currentManagedProfile().agent,
        rank: 'MANAGER',
        adminProvisionedAccess: {
          id: 'access-1',
          updatedAt: ACCESS_UPDATED_AT,
          individualRank: 'MANAGER',
          platformSubscription: { plan: 'AGENT_INDIVIDUAL' },
        },
        agencyMemberships: [],
      },
    })
    mocks.txAdminProvisionedAccessUpdateMany.mockResolvedValue({ count: 0 })

    const result = await updateManagedUserProfileAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      profileForm({
        expectedAgencyUpdatedAt: '',
        rank: 'DIRECTOR',
        agencyName: '',
      }),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este perfil mudou em outra sessão. Atualize a página antes de salvar novamente.',
    })
    expect(mocks.txAuditCreate).not.toHaveBeenCalled()
  })

  it('rejects a stale edit without writing or auditing', async () => {
    mocks.txUserFindUnique.mockResolvedValue({
      ...currentManagedProfile(),
      updatedAt: new Date('2026-09-01T16:01:00.000Z'),
    })

    const result = await updateManagedUserProfileAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      profileForm(),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este perfil mudou em outra sessão. Atualize a página antes de salvar novamente.',
    })
    expect(mocks.txUserUpdateMany).not.toHaveBeenCalled()
    expect(mocks.txAuditCreate).not.toHaveBeenCalled()
  })
})

describe('updateManagedUserAccessAction', () => {
  it('suspends through Better Auth without changing operational Agent status and records a reasoned audit', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      role: 'AGENT',
      banned: false,
      banReason: null,
      agent: { id: AGENT_ID, status: 'ACTIVE' },
    })

    const result = await updateManagedUserAccessAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      accessForm('SUSPEND'),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Conta suspensa e sessões encerradas.',
    })
    expect(mocks.banUser).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { userId: TARGET_ID, banReason: 'Solicitação da gerência' },
    })
    expect(mocks.agentUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ADMIN_ID,
        action: 'ADMIN_USER_SUSPENDED',
        entityId: TARGET_ID,
        before: expect.objectContaining({ accessStatus: 'ACTIVE' }),
        after: expect.objectContaining({
          accessStatus: 'SUSPENDED',
          reason: 'Solicitação da gerência',
        }),
      }),
    })
  })

  it('restores Better Auth access without reactivating an operationally inactive Agent', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      role: 'AGENT',
      banned: true,
      banReason: 'Revisão de compliance',
      agent: { id: AGENT_ID, status: 'INACTIVE' },
    })

    const result = await updateManagedUserAccessAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      accessForm('RESTORE', ''),
    )

    expect(result).toEqual({ status: 'success', message: 'Acesso do usuário restaurado.' })
    expect(mocks.unbanUser).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { userId: TARGET_ID },
    })
    expect(mocks.agentUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ADMIN_USER_RESTORED',
        after: expect.objectContaining({ reason: null }),
      }),
    })
  })

  it('does not allow the current administrator to suspend their own account', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: ADMIN_ID,
      role: 'ADMIN',
      banned: false,
      banReason: null,
      agent: null,
    })

    const selfSuspendForm = accessForm('SUSPEND', 'Teste de bloqueio')
    selfSuspendForm.set('userId', ADMIN_ID)
    const result = await updateManagedUserAccessAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      selfSuspendForm,
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Você não pode suspender a própria conta.',
    })
    expect(mocks.banUser).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('does not allow one administrator to suspend another administrator', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      role: 'ADMIN',
      banned: false,
      banReason: null,
    })

    const result = await updateManagedUserAccessAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      accessForm('SUSPEND'),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Contas administrativas não podem ser suspensas por este painel.',
    })
    expect(mocks.banUser).not.toHaveBeenCalled()
  })
})

describe('requestManagedUserPasswordResetAction', () => {
  it('sends the official reset email and never audits a password or reset token', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      email: 'maria@example.com',
      language: 'PT',
      banned: false,
    })

    const result = await requestManagedUserPasswordResetAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Enviamos a redefinição para maria@example.com.',
    })
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { email: 'maria@example.com', redirectTo: '/reset-password?lang=PT' },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: ADMIN_ID,
        action: 'ADMIN_PASSWORD_RESET_REQUESTED',
        entity: 'User',
        entityId: TARGET_ID,
        after: { delivery: 'EMAIL', recipient: 'maria@example.com' },
      },
    })
    const auditedPayload = JSON.stringify(mocks.auditCreate.mock.calls[0]?.[0]?.data?.after)
    expect(auditedPayload).not.toMatch(/password|senha|token|resetUrl/i)
  })

  it('does not send a reset to a suspended account', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      email: 'maria@example.com',
      language: 'PT',
      banned: true,
    })

    const result = await requestManagedUserPasswordResetAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(),
    )

    expect(result.status).toBe('error')
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe('resendManagedUserVerificationAction', () => {
  it('removes the administrator cookie before sending verification to another user', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      email: 'maria@example.com',
      emailVerified: false,
      banned: false,
    })

    const result = await resendManagedUserVerificationAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(),
    )

    expect(result.status).toBe('success')
    const invocation = mocks.sendVerificationEmail.mock.calls[0]?.[0]
    expect(invocation.body).toEqual({
      email: 'maria@example.com',
      callbackURL: '/login?verified=1',
    })
    expect(invocation.headers).toBeInstanceOf(Headers)
    expect(invocation.headers.get('origin')).toBe('https://app.keeprone.com')
    expect(invocation.headers.get('cookie')).toBeNull()
    expect(invocation.headers.get('authorization')).toBeNull()
  })
})

describe('revokeManagedUserSessionsAction', () => {
  it('revokes every target session through Better Auth and audits only the session count', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      role: 'AGENT',
      _count: { sessions: 3 },
    })

    const result = await revokeManagedUserSessionsAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Todas as sessões do usuário foram encerradas.',
    })
    expect(mocks.revokeUserSessions).toHaveBeenCalledWith({
      headers: REQUEST_HEADERS,
      body: { userId: TARGET_ID },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: ADMIN_ID,
        action: 'ADMIN_USER_SESSIONS_REVOKED',
        entity: 'User',
        entityId: TARGET_ID,
        before: { activeSessions: 3, delegatedPreviewSessions: 0 },
        after: { activeSessions: 0 },
      },
    })
  })

  it('also revokes every active support preview opened by a staff account', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: TARGET_ID,
      role: 'ADMIN',
      _count: { sessions: 2 },
    })
    mocks.sessionFindMany.mockResolvedValue([
      { token: 'preview-token-1' },
      { token: 'preview-token-2' },
    ])

    const result = await revokeManagedUserSessionsAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(),
    )

    expect(result.status).toBe('success')
    expect(mocks.sessionFindMany).toHaveBeenCalledWith({
      where: { impersonatedBy: TARGET_ID },
      select: { token: true },
    })
    expect(mocks.revokeUserSession).toHaveBeenCalledTimes(2)
    expect(mocks.revokeUserSession).toHaveBeenNthCalledWith(1, {
      headers: REQUEST_HEADERS,
      body: { sessionToken: 'preview-token-1' },
    })
  })

  it('preserves the current administrator session', async () => {
    const result = await revokeManagedUserSessionsAction(
      INITIAL_ADMIN_USER_ACTION_STATE,
      resetForm(ADMIN_ID),
    )

    expect(result.status).toBe('error')
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled()
  })
})
