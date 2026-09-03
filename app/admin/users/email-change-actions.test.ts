import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RAW_TOKEN = 'a'.repeat(43)
const TOKEN_HASH = '1'.repeat(64)

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  assertSameOriginAction: vi.fn(),
  requireRole: vi.fn(),
  createToken: vi.fn(),
  confirmationUrl: vi.fn(),
  sendAuthorizationEmail: vi.fn(),
  transaction: vi.fn(),
  requestDeleteMany: vi.fn(),
  requestFindFirst: vi.fn(),
  requestCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}))

const transactionClient = {
  adminEmailChangeRequest: {
    deleteMany: mocks.requestDeleteMany,
    findFirst: mocks.requestFindFirst,
    create: mocks.requestCreate,
  },
  user: {
    findUnique: mocks.userFindUnique,
    findFirst: mocks.userFindFirst,
    updateMany: mocks.userUpdateMany,
  },
  auditLog: { create: mocks.auditCreate },
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
vi.mock('@/lib/admin/email-change', () => ({
  ADMIN_EMAIL_CHANGE_TTL_MS: 60 * 60 * 1000,
  normalizeLoginEmail: (value: string) => value.trim().toLowerCase(),
  createAdminEmailChangeToken: mocks.createToken,
  adminEmailChangeConfirmationUrl: mocks.confirmationUrl,
}))
vi.mock('@/lib/email/send', () => ({
  sendAdminEmailChangeAuthorizationEmail: mocks.sendAuthorizationEmail,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import {
  requestManagedUserEmailChangeAction,
} from './email-change-actions'

const INITIAL_EMAIL_CHANGE_REQUEST_STATE = { status: 'idle' as const, message: '' }

const ADMIN_ID = 'cm0h7x7qf0000abcde1234567'
const TARGET_ID = 'clh3amg6u0000n0v5xk4l6p8q'
const UPDATED_AT = new Date('2026-09-01T17:00:00.000Z')
const NOW = new Date('2026-09-01T18:00:00.000Z')
const REQUEST_HEADERS = new Headers({
  origin: 'https://app.keeprone.com',
  host: 'app.keeprone.com',
})

function requestForm(
  overrides: Partial<{ userId: string; expectedUpdatedAt: string; newEmail: string }> = {},
) {
  const formData = new FormData()
  formData.set('userId', overrides.userId ?? TARGET_ID)
  formData.set('expectedUpdatedAt', overrides.expectedUpdatedAt ?? UPDATED_AT.toISOString())
  formData.set('newEmail', overrides.newEmail ?? 'NEW.Login@Example.COM')
  return formData
}

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET_ID,
    email: 'current@example.com',
    emailVerified: true,
    name: 'Maria Silva',
    language: 'PT',
    role: 'AGENT',
    banned: false,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(REQUEST_HEADERS)
  mocks.requireRole.mockResolvedValue({ user: { id: ADMIN_ID, role: 'ADMIN' } })
  mocks.createToken.mockReturnValue({ rawToken: RAW_TOKEN, tokenHash: TOKEN_HASH })
  mocks.confirmationUrl.mockReturnValue(
    `https://app.keeprone.com/confirm-email-change?token=${RAW_TOKEN}&lang=PT`,
  )
  mocks.sendAuthorizationEmail.mockResolvedValue(undefined)
  mocks.requestDeleteMany.mockResolvedValue({ count: 0 })
  mocks.requestFindFirst.mockResolvedValue(null)
  mocks.requestCreate.mockResolvedValue({ id: 'request-1' })
  mocks.userFindUnique.mockResolvedValue(target())
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.userUpdateMany.mockResolvedValue({ count: 1 })
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
  mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('requestManagedUserEmailChangeAction', () => {
  it('enforces same-origin and ADMIN authorization before opening a transaction', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden: insufficient role'))

    await expect(requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm(),
    )).rejects.toThrow('Forbidden: insufficient role')

    expect(mocks.assertSameOriginAction).toHaveBeenCalledWith({
      origin: 'https://app.keeprone.com',
      host: 'app.keeprone.com',
      forwardedHost: null,
      forwardedProto: null,
    })
    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('reserves only token hash, audits without secrets and sends the first approval to the current email', async () => {
    const result = await requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm(),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Autorização enviada para current@example.com. O e-mail atual permanece ativo até os dois endereços confirmarem.',
    })
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: TARGET_ID, updatedAt: UPDATED_AT },
      data: { updatedAt: NOW },
    })
    const createdData = mocks.requestCreate.mock.calls[0]?.[0]?.data
    expect(createdData).toMatchObject({
      userId: TARGET_ID,
      requestedById: ADMIN_ID,
      originalEmail: 'current@example.com',
      originalEmailVerified: true,
      newEmail: 'new.login@example.com',
      currentTokenHash: TOKEN_HASH,
      expectedUserUpdatedAt: NOW,
      expiresAt: new Date('2026-09-01T19:00:00.000Z'),
    })
    expect(JSON.stringify(createdData)).not.toContain(RAW_TOKEN)
    expect(mocks.confirmationUrl).toHaveBeenCalledWith(RAW_TOKEN, 'PT')
    expect(mocks.sendAuthorizationEmail).toHaveBeenCalledWith({
      to: 'current@example.com',
      accountName: 'Maria Silva',
      newEmail: 'new.login@example.com',
      authorizationUrl: `https://app.keeprone.com/confirm-email-change?token=${RAW_TOKEN}&lang=PT`,
      expiresAt: new Date('2026-09-01T19:00:00.000Z'),
      language: 'PT',
      idempotencyKey: 'admin-email-change-current-request-1',
    })

    // The first step only locks updatedAt. The login identity remains the old
    // address until the new inbox approves the second one-time link.
    expect(mocks.userUpdateMany.mock.calls.flatMap((call) => Object.keys(call[0].data)))
      .not.toContain('email')
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ADMIN_ID,
        action: 'ADMIN_USER_EMAIL_CHANGE_REQUESTED',
        entityId: TARGET_ID,
        before: { email: 'current@example.com', emailVerified: true },
        after: expect.objectContaining({
          requestedEmail: 'new.login@example.com',
          approvalSteps: ['CURRENT_EMAIL', 'NEW_EMAIL'],
        }),
      }),
    })
    const auditPayload = JSON.stringify(mocks.auditCreate.mock.calls[0]?.[0]?.data)
    expect(auditPayload).not.toContain(RAW_TOKEN)
    expect(auditPayload).not.toContain(TOKEN_HASH)
  })

  it('protects the current administrator from changing their own login email', async () => {
    const result = await requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm({ userId: ADMIN_ID }),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('não pode trocar o próprio e-mail')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.sendAuthorizationEmail).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'administrative target', changes: { role: 'ADMIN' }, message: 'conta administrativa' },
    { label: 'suspended target', changes: { banned: true }, message: 'Restaure o acesso' },
  ])('rejects a protected $label before reserving or sending', async ({ changes, message }) => {
    mocks.userFindUnique.mockResolvedValue(target(changes))

    const result = await requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm(),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain(message)
    expect(mocks.requestCreate).not.toHaveBeenCalled()
    expect(mocks.sendAuthorizationEmail).not.toHaveBeenCalled()
  })

  it('rejects a login address owned by another user or reserved request', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'other-user' })

    const result = await requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm(),
    )

    expect(result).toMatchObject({ status: 'error', fieldErrors: { newEmail: expect.any(String) } })
    expect(result.message).toContain('já pertence')
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
    expect(mocks.requestCreate).not.toHaveBeenCalled()
  })

  it('uses the optimistic updatedAt lock to stop a concurrent request', async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 })

    const result = await requestManagedUserEmailChangeAction(
      INITIAL_EMAIL_CHANGE_REQUEST_STATE,
      requestForm(),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('mudou em outra sessão')
    expect(mocks.requestCreate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.sendAuthorizationEmail).not.toHaveBeenCalled()
  })
})
