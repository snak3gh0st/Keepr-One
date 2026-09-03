import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const transaction = {
    $executeRaw: vi.fn(),
    user: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    account: { findFirst: vi.fn() },
    auditLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  }
  return {
    transaction,
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => unknown) => callback(transaction)),
    updateUser: vi.fn(),
    createAudit: vi.fn(),
    createVerificationValue: vi.fn(),
    deleteVerificationByIdentifier: vi.fn(),
    sendResetPasswordEmail: vi.fn(),
    captureException: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.runTransaction,
    user: { updateMany: mocks.updateUser },
    auditLog: { create: mocks.createAudit },
  },
}))
vi.mock('@/lib/auth', () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createVerificationValue: mocks.createVerificationValue,
        deleteVerificationByIdentifier: mocks.deleteVerificationByIdentifier,
      },
    }),
  },
}))
vi.mock('@/lib/email/send', () => ({ sendResetPasswordEmail: mocks.sendResetPasswordEmail }))
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))

import { handleFirstAdminBootstrap } from './route'

const ENDPOINT = 'https://app.keeprone.com/api/internal/bootstrap-first-admin'
const TEST_SECRET = 'a'.repeat(64)
const TEST_SECRET_SHA256 = createHash('sha256').update(TEST_SECRET).digest('hex')
const TEST_EMAIL = 'admin@example.com'
const TEST_EMAIL_SHA256 = createHash('sha256').update(TEST_EMAIL).digest('hex')
const AUTHORIZATION = `Bearer ${TEST_SECRET}`

function bootstrap(request: Request) {
  return handleFirstAdminBootstrap(request, {
    bootstrapSecretSha256: TEST_SECRET_SHA256,
    allowedEmailSha256: TEST_EMAIL_SHA256,
  })
}

function request(email = TEST_EMAIL, authorization = AUTHORIZATION) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      origin: 'https://app.keeprone.com',
    },
    body: JSON.stringify({ email }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.user.findFirst.mockResolvedValue(null)
  mocks.transaction.user.findMany.mockResolvedValue([])
  mocks.transaction.user.create.mockResolvedValue({ id: 'admin-1' })
  mocks.transaction.account.findFirst.mockResolvedValue(null)
  mocks.transaction.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  mocks.transaction.auditLog.findFirst.mockResolvedValue(null)
  mocks.updateUser.mockResolvedValue({ count: 1 })
  mocks.createVerificationValue.mockResolvedValue({ id: 'verification-1' })
  mocks.deleteVerificationByIdentifier.mockResolvedValue(undefined)
  mocks.sendResetPasswordEmail.mockResolvedValue(undefined)
  mocks.createAudit.mockResolvedValue({ id: 'audit-2' })
})

describe('one-time first admin bootstrap', () => {
  it('conceals the endpoint when the origin, token, or email is not authorized', async () => {
    const wrongOrigin = request()
    wrongOrigin.headers.set('origin', 'https://attacker.example')
    expect((await bootstrap(wrongOrigin)).status).toBe(404)

    expect((await bootstrap(request(undefined, 'Bearer wrong'))).status).toBe(404)
    expect((await bootstrap(request('other@example.com'))).status).toBe(404)
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('creates only the allowlisted first admin and requests password setup', async () => {
    const response = await bootstrap(request())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      state: 'CREATED',
      emailSent: true,
    })
    expect(mocks.transaction.$executeRaw).toHaveBeenCalledOnce()
    expect(mocks.runTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    )
    expect(mocks.transaction.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: TEST_EMAIL, mode: 'insensitive' } },
      select: { id: true, role: true, banned: true },
    })
    expect(mocks.transaction.user.create).toHaveBeenCalledWith({
      data: {
        email: TEST_EMAIL,
        name: 'Administrador Keepr One',
        role: 'ADMIN',
        language: 'PT',
        timeZone: 'America/New_York',
        emailVerified: false,
      },
      select: { id: true },
    })
    expect(mocks.createVerificationValue).toHaveBeenCalledWith({
      identifier: expect.stringMatching(/^reset-password:[A-Za-z0-9_-]{43}$/),
      value: 'admin-1',
      expiresAt: expect.any(Date),
    })
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: {
        id: 'admin-1',
        email: TEST_EMAIL,
        role: 'ADMIN',
        banned: false,
      },
      data: { emailVerified: true },
    })
    expect(mocks.sendResetPasswordEmail).toHaveBeenCalledWith({
      to: TEST_EMAIL,
      resetUrl: expect.stringMatching(
        /^https:\/\/app\.keeprone\.com\/api\/auth\/reset-password\/[A-Za-z0-9_-]{43}\?callbackURL=/,
      ),
      language: 'PT',
    })
    const verification = mocks.createVerificationValue.mock.calls[0]?.[0]
    const delivery = mocks.sendResetPasswordEmail.mock.calls[0]?.[0]
    const resetUrl = new URL(delivery.resetUrl)
    expect(resetUrl.pathname).toBe(
      `/api/auth/reset-password/${verification.identifier.replace('reset-password:', '')}`,
    )
    expect(resetUrl.searchParams.get('callbackURL')).toBe('/reset-password?lang=PT&portal=admin')
  })

  it('refuses to create an account when an administrator already exists', async () => {
    mocks.transaction.user.findMany.mockResolvedValue([{ id: 'another-admin' }])

    const response = await bootstrap(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'BOOTSTRAP_UNAVAILABLE' })
    expect(mocks.transaction.user.create).not.toHaveBeenCalled()
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'the email belongs to a non-admin',
      target: { id: 'agent-1', role: 'AGENT', banned: false },
      administrators: [],
      bootstrapAudit: null,
    },
    {
      label: 'the bootstrap admin is banned',
      target: { id: 'admin-1', role: 'ADMIN', banned: true },
      administrators: [{ id: 'admin-1' }],
      bootstrapAudit: { id: 'bootstrap-audit' },
    },
    {
      label: 'an existing admin lacks the bootstrap audit',
      target: { id: 'admin-1', role: 'ADMIN', banned: false },
      administrators: [{ id: 'admin-1' }],
      bootstrapAudit: null,
    },
    {
      label: 'more than one administrator exists',
      target: { id: 'admin-1', role: 'ADMIN', banned: false },
      administrators: [{ id: 'admin-1' }, { id: 'admin-2' }],
      bootstrapAudit: { id: 'bootstrap-audit' },
    },
  ])('stays unavailable when $label', async ({ target, administrators, bootstrapAudit }) => {
    mocks.transaction.user.findFirst.mockResolvedValue(target)
    mocks.transaction.user.findMany.mockResolvedValue(administrators)
    mocks.transaction.auditLog.findFirst.mockResolvedValue(bootstrapAudit)

    const response = await bootstrap(request())

    expect(response.status).toBe(409)
    expect(mocks.transaction.user.create).not.toHaveBeenCalled()
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
  })

  it('is idempotent only for the account created by this bootstrap', async () => {
    mocks.transaction.user.findFirst.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', banned: false })
    mocks.transaction.user.findMany.mockResolvedValue([{ id: 'admin-1' }])
    mocks.transaction.auditLog.findFirst.mockResolvedValue({ id: 'bootstrap-audit' })
    mocks.transaction.account.findFirst.mockResolvedValue({ id: 'credential-1' })

    const response = await bootstrap(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      state: 'ALREADY_CREATED',
    })
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
  })

  it('keeps the account passwordless when email delivery fails', async () => {
    mocks.sendResetPasswordEmail.mockRejectedValue(new Error('provider unavailable'))

    const response = await bootstrap(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      partial: true,
      state: 'CREATED',
      emailSent: false,
    })
    expect(mocks.transaction.user.create).toHaveBeenCalledOnce()
    expect(mocks.deleteVerificationByIdentifier).toHaveBeenCalledWith(
      expect.stringMatching(/^reset-password:[A-Za-z0-9_-]{43}$/),
    )
    expect(mocks.captureException).toHaveBeenCalled()
  })

  it('can reissue password setup after a delivery failure or interrupted request', async () => {
    mocks.transaction.user.findFirst.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', banned: false })
    mocks.transaction.user.findMany.mockResolvedValue([{ id: 'admin-1' }])
    mocks.transaction.auditLog.findFirst.mockResolvedValue({ id: 'bootstrap-audit' })
    mocks.transaction.account.findFirst.mockResolvedValue(null)

    const response = await bootstrap(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      state: 'PASSWORD_SETUP_REISSUED',
      emailSent: true,
    })
    expect(mocks.transaction.user.create).not.toHaveBeenCalled()
    expect(mocks.sendResetPasswordEmail).toHaveBeenCalledOnce()
  })

  it('does not report delivery when the admin verification state changed', async () => {
    mocks.updateUser.mockResolvedValue({ count: 0 })

    const response = await bootstrap(request())

    expect(response.status).toBe(502)
    expect(mocks.sendResetPasswordEmail).toHaveBeenCalledOnce()
    expect(mocks.deleteVerificationByIdentifier).toHaveBeenCalledOnce()
  })

  it('reports a transaction failure without leaking details or attempting email', async () => {
    mocks.runTransaction.mockRejectedValueOnce(new Error('database credentials'))

    const response = await bootstrap(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'BOOTSTRAP_FAILED' })
    expect(mocks.sendResetPasswordEmail).not.toHaveBeenCalled()
    expect(mocks.captureException).toHaveBeenCalledOnce()
  })

  it('treats post-delivery audit failure as non-fatal', async () => {
    mocks.createAudit.mockRejectedValueOnce(new Error('audit temporarily unavailable'))

    const response = await bootstrap(request())

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ emailSent: true })
    expect(mocks.captureException).toHaveBeenCalledOnce()
  })

  it('rejects malformed and oversized bodies before opening a transaction', async () => {
    const malformed = new Request(ENDPOINT, {
      method: 'POST',
      headers: { authorization: AUTHORIZATION, origin: 'https://app.keeprone.com' },
      body: '{',
    })
    expect((await bootstrap(malformed)).status).toBe(400)

    const oversized = request()
    oversized.headers.set('content-length', '1025')
    expect((await bootstrap(oversized)).status).toBe(400)
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })
})
