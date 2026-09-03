import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CURRENT_RAW_TOKEN = 'a'.repeat(43)
const NEW_RAW_TOKEN = 'b'.repeat(43)
const CURRENT_TOKEN_HASH = '1'.repeat(64)
const NEW_TOKEN_HASH = '2'.repeat(64)

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  headers: vi.fn(),
  assertSameOriginAction: vi.fn(),
  hashToken: vi.fn(),
  createToken: vi.fn(),
  confirmationUrl: vi.fn(),
  revokeAllAuthSessions: vi.fn(),
  sendVerificationEmail: vi.fn(),
  transaction: vi.fn(),
  requestFindFirst: vi.fn(),
  requestFindUnique: vi.fn(),
  requestUpdateMany: vi.fn(),
  requestDeleteMany: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}))

const transactionClient = {
  adminEmailChangeRequest: {
    findFirst: mocks.requestFindFirst,
    findUnique: mocks.requestFindUnique,
    updateMany: mocks.requestUpdateMany,
    deleteMany: mocks.requestDeleteMany,
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
vi.mock('@/lib/admin/email-change', () => ({
  ADMIN_EMAIL_CHANGE_TOKEN_PATTERN: /^[A-Za-z0-9_-]{43}$/,
  ADMIN_EMAIL_CHANGE_TTL_MS: 60 * 60 * 1000,
  normalizeLoginEmail: (value: string) => value.trim().toLowerCase(),
  hashAdminEmailChangeToken: mocks.hashToken,
  createAdminEmailChangeToken: mocks.createToken,
  adminEmailChangeConfirmationUrl: mocks.confirmationUrl,
}))
vi.mock('@/lib/auth-session-revocation', () => ({
  revokeAllAuthSessions: mocks.revokeAllAuthSessions,
}))
vi.mock('@/lib/email/send', () => ({
  sendAdminEmailChangeVerificationEmail: mocks.sendVerificationEmail,
}))
vi.mock('@/lib/i18n/catalog', () => ({
  localize: (language: 'PT' | 'EN', portuguese: string, english: string) =>
    language === 'PT' ? portuguese : english,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import {
  confirmAdminEmailChangeAction,
  INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
} from './actions'

const ADMIN_ID = 'cm0h7x7qf0000abcde1234567'
const TARGET_ID = 'clh3amg6u0000n0v5xk4l6p8q'
const EXPECTED_UPDATED_AT = new Date('2026-09-01T17:00:00.000Z')
const NOW = new Date('2026-09-01T18:00:00.000Z')
const FUTURE = new Date('2026-09-01T19:00:00.000Z')
const REQUEST_HEADERS = new Headers({
  origin: 'https://app.keeprone.com',
  host: 'app.keeprone.com',
})

function confirmationForm(token: string, language: 'PT' | 'EN' = 'PT') {
  const formData = new FormData()
  formData.set('token', token)
  formData.set('language', language)
  return formData
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    userId: TARGET_ID,
    requestedById: ADMIN_ID,
    originalEmail: 'current@example.com',
    originalEmailVerified: true,
    newEmail: 'new@example.com',
    currentTokenHash: CURRENT_TOKEN_HASH,
    newTokenHash: null,
    expectedUserUpdatedAt: EXPECTED_UPDATED_AT,
    expiresAt: FUTURE,
    currentApprovedAt: null,
    newTokenExpiresAt: null,
    version: 1,
    user: {
      id: TARGET_ID,
      email: 'current@example.com',
      emailVerified: true,
      name: 'Maria Silva',
      language: 'PT',
      role: 'AGENT',
      banned: false,
      updatedAt: EXPECTED_UPDATED_AT,
    },
    ...overrides,
  }
}

function readyForNewEmailConfirmation(overrides: Record<string, unknown> = {}) {
  return pendingRequest({
    newTokenHash: NEW_TOKEN_HASH,
    currentApprovedAt: new Date('2026-09-01T18:00:00.000Z'),
    newTokenExpiresAt: FUTURE,
    version: 2,
    ...overrides,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(REQUEST_HEADERS)
  mocks.hashToken.mockImplementation((token: string) =>
    token === CURRENT_RAW_TOKEN ? CURRENT_TOKEN_HASH : NEW_TOKEN_HASH)
  mocks.createToken.mockReturnValue({ rawToken: NEW_RAW_TOKEN, tokenHash: NEW_TOKEN_HASH })
  mocks.confirmationUrl.mockReturnValue(
    `https://app.keeprone.com/confirm-email-change?token=${NEW_RAW_TOKEN}&lang=PT`,
  )
  mocks.revokeAllAuthSessions.mockResolvedValue(undefined)
  mocks.sendVerificationEmail.mockResolvedValue(undefined)
  mocks.requestFindFirst.mockResolvedValue(pendingRequest())
  mocks.requestFindUnique.mockResolvedValue({
    newTokenHash: NEW_TOKEN_HASH,
    currentApprovedAt: new Date('2026-09-01T18:00:00.000Z'),
    newTokenExpiresAt: FUTURE,
    version: 2,
  })
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 })
  mocks.requestDeleteMany.mockResolvedValue({ count: 1 })
  mocks.userFindUnique.mockResolvedValue({ role: 'ADMIN', banned: false })
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.userUpdateMany.mockResolvedValue({ count: 1 })
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
  mocks.transaction.mockImplementation(async (callback: (tx: typeof transactionClient) => unknown) =>
    callback(transactionClient))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('confirmAdminEmailChangeAction', () => {
  it('validates same-origin, approves the current inbox and sends the second link to the new inbox', async () => {
    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(CURRENT_RAW_TOKEN),
    )

    expect(result).toEqual({
      status: 'success',
      completed: false,
      message: 'Primeira etapa concluída. Enviamos a confirmação final para new@example.com.',
    })
    expect(mocks.assertSameOriginAction).toHaveBeenCalledWith({
      origin: 'https://app.keeprone.com',
      host: 'app.keeprone.com',
      forwardedHost: null,
      forwardedProto: null,
    })
    expect(mocks.requestFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { currentTokenHash: CURRENT_TOKEN_HASH },
          { newTokenHash: CURRENT_TOKEN_HASH },
        ],
      },
    }))
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith({
      where: { id: 'request-1', version: 1, currentApprovedAt: null },
      data: {
        currentApprovedAt: NOW,
        newTokenHash: NEW_TOKEN_HASH,
        newTokenExpiresAt: FUTURE,
        expiresAt: FUTURE,
        version: { increment: 1 },
      },
    })
    expect(mocks.confirmationUrl).toHaveBeenCalledWith(NEW_RAW_TOKEN, 'PT')
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'new@example.com',
      accountName: 'Maria Silva',
      confirmationUrl: `https://app.keeprone.com/confirm-email-change?token=${NEW_RAW_TOKEN}&lang=PT`,
      expiresAt: FUTURE,
      language: 'PT',
      idempotencyKey: 'admin-email-change-new-request-1-v2',
    })
    expect(mocks.revokeAllAuthSessions).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()

    const persistedApproval = JSON.stringify(mocks.requestUpdateMany.mock.calls[0]?.[0])
    expect(persistedApproval).toContain(NEW_TOKEN_HASH)
    expect(persistedApproval).not.toContain(NEW_RAW_TOKEN)
    const auditPayload = JSON.stringify(mocks.auditCreate.mock.calls[0]?.[0]?.data)
    expect(auditPayload).toContain('CURRENT_EMAIL')
    expect(auditPayload).not.toContain(CURRENT_RAW_TOKEN)
    expect(auditPayload).not.toContain(CURRENT_TOKEN_HASH)
    expect(auditPayload).not.toContain(NEW_RAW_TOKEN)
    expect(auditPayload).not.toContain(NEW_TOKEN_HASH)
  })

  it('completes current→new only after revoking every session, then consumes the token', async () => {
    mocks.requestFindFirst.mockResolvedValue(readyForNewEmailConfirmation())

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(NEW_RAW_TOKEN),
    )

    expect(result).toEqual({
      status: 'success',
      completed: true,
      message: 'Novo e-mail confirmado. Todas as sessões anteriores foram encerradas.',
      loginEmail: 'new@example.com',
    })
    expect(mocks.revokeAllAuthSessions).toHaveBeenCalledWith(TARGET_ID)
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: TARGET_ID,
        email: 'current@example.com',
        updatedAt: EXPECTED_UPDATED_AT,
        role: { not: 'ADMIN' },
        banned: false,
      },
      data: {
        email: 'new@example.com',
        emailVerified: true,
        updatedAt: NOW,
      },
    })
    expect(mocks.revokeAllAuthSessions.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.userUpdateMany.mock.invocationCallOrder[0])
    expect(mocks.requestDeleteMany).toHaveBeenCalledWith({
      where: { id: 'request-1', version: 2 },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ADMIN_ID,
        action: 'ADMIN_USER_EMAIL_CHANGE_COMPLETED',
        entityId: TARGET_ID,
        before: { email: 'current@example.com', emailVerified: true },
        after: {
          email: 'new@example.com',
          emailVerified: true,
          approvals: ['CURRENT_EMAIL', 'NEW_EMAIL'],
          sessionsRevoked: true,
        },
      }),
    })
    const auditPayload = JSON.stringify(mocks.auditCreate.mock.calls.at(-1)?.[0]?.data)
    expect(auditPayload).not.toContain(NEW_RAW_TOKEN)
    expect(auditPayload).not.toContain(NEW_TOKEN_HASH)
  })

  it('fails closed before changing the email when session revocation fails', async () => {
    mocks.requestFindFirst.mockResolvedValue(readyForNewEmailConfirmation())
    mocks.revokeAllAuthSessions.mockRejectedValue(new Error('redis unavailable'))

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(NEW_RAW_TOKEN),
    )

    expect(result).toMatchObject({ status: 'error', canRetry: true })
    expect(result.message).toContain('e-mail não foi alterado')
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
    expect(mocks.requestDeleteMany).not.toHaveBeenCalled()
  })

  it('expires and consumes an old current-email token without sending the second email', async () => {
    mocks.requestFindFirst.mockResolvedValue(pendingRequest({ expiresAt: NOW }))

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(CURRENT_RAW_TOKEN),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este link expirou. Solicite um novo ao administrador.',
    })
    expect(mocks.requestDeleteMany).toHaveBeenCalledWith({
      where: { id: 'request-1', version: 1 },
    })
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    expect(mocks.revokeAllAuthSessions).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })

  it('reports optimistic confirmation contention without issuing another link', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 })

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(CURRENT_RAW_TOKEN),
    )

    expect(result).toMatchObject({ status: 'error', canRetry: true })
    expect(result.message).toContain('já está sendo processada')
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })

  it('rechecks new-email uniqueness before either approval stage', async () => {
    mocks.userFindFirst.mockResolvedValue({ id: 'another-user' })

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(CURRENT_RAW_TOKEN),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Este endereço já está associado a outra conta.',
    })
    expect(mocks.requestUpdateMany).not.toHaveBeenCalled()
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'requesting administrator is no longer active',
      requester: { role: 'AGENT', banned: false },
      target: {},
      message: 'solicitação administrativa não está mais ativa',
    },
    {
      label: 'target became an administrator',
      requester: { role: 'ADMIN', banned: false },
      target: { role: 'ADMIN' },
      message: 'conta administrativa é protegida',
    },
    {
      label: 'target was suspended',
      requester: { role: 'ADMIN', banned: false },
      target: { banned: true },
      message: 'conta está suspensa',
    },
  ])('fails closed when the $label', async ({ requester, target, message }) => {
    mocks.userFindUnique.mockResolvedValue(requester)
    mocks.requestFindFirst.mockResolvedValue(pendingRequest({
      user: { ...pendingRequest().user, ...target },
    }))

    const result = await confirmAdminEmailChangeAction(
      INITIAL_CONFIRM_EMAIL_CHANGE_STATE,
      confirmationForm(CURRENT_RAW_TOKEN),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain(message)
    expect(mocks.requestUpdateMany).not.toHaveBeenCalled()
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
  })
})
