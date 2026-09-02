import { describe, expect, it, vi } from 'vitest'
import type { BetterAuthOptions } from 'better-auth'

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn((options: BetterAuthOptions) => {
    void options
    return {}
  }),
  prismaAdapter: vi.fn(() => ({})),
  createRedisSecondaryStorage: vi.fn(() => undefined),
  nextCookies: vi.fn(() => ({ id: 'next-cookies' })),
  sendChangeEmailConfirmationEmail: vi.fn(),
  sendResetPasswordEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))

vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }))
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: mocks.prismaAdapter }))
vi.mock('better-auth/next-js', () => ({ nextCookies: mocks.nextCookies }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/email/send', () => ({
  sendChangeEmailConfirmationEmail: mocks.sendChangeEmailConfirmationEmail,
  sendResetPasswordEmail: mocks.sendResetPasswordEmail,
  sendVerificationEmail: mocks.sendVerificationEmail,
}))
vi.mock('@/lib/redis/secondary-storage', () => ({
  createRedisSecondaryStorage: mocks.createRedisSecondaryStorage,
}))

import './auth'

describe('auth security configuration', () => {
  it('disables generic signup, protects role and installs the cookie bridge last', () => {
    const options = mocks.betterAuth.mock.calls[0]?.[0]

    expect(options).toEqual(expect.objectContaining({
      emailAndPassword: expect.objectContaining({ disableSignUp: true }),
      user: expect.objectContaining({
        additionalFields: expect.objectContaining({
          role: expect.objectContaining({ input: false }),
          language: expect.objectContaining({
            type: 'string',
            required: true,
            defaultValue: 'PT',
          }),
        }),
      }),
      rateLimit: expect.objectContaining({ storage: 'memory' }),
    }))
    expect(options.plugins).toEqual([{ id: 'next-cookies' }])
    expect(mocks.nextCookies).toHaveBeenCalledTimes(1)
  })

  it('changes email only after verification and confirms through the old inbox when possible', async () => {
    const options = mocks.betterAuth.mock.calls[0]?.[0]
    const verificationSender = options?.emailVerification?.sendVerificationEmail
    const confirmationSender = options?.user?.changeEmail?.sendChangeEmailConfirmation
    const baseUser = {
      id: 'user-1',
      name: 'Agente Teste',
      email: 'atual@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date('2026-08-26T00:00:00.000Z'),
      updatedAt: new Date('2026-08-26T00:00:00.000Z'),
    }

    expect(options?.user?.changeEmail).toEqual(expect.objectContaining({
      enabled: true,
      updateEmailWithoutVerification: false,
      sendChangeEmailConfirmation: expect.any(Function),
    }))
    expect(options?.emailVerification).toEqual(expect.objectContaining({
      sendVerificationEmail: expect.any(Function),
    }))

    await verificationSender!({
      user: { ...baseUser, email: 'novo@example.com' },
      url: 'https://app.keeprone.com/api/auth/verify-email?token=new',
      token: 'new',
    })
    await confirmationSender!({
      user: baseUser,
      newEmail: 'novo@example.com',
      url: 'https://app.keeprone.com/api/auth/verify-email?token=old',
      token: 'old',
    })

    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'novo@example.com',
      verificationUrl: 'https://app.keeprone.com/api/auth/verify-email?token=new',
      language: 'PT',
    })
    expect(mocks.sendChangeEmailConfirmationEmail).toHaveBeenCalledWith({
      to: 'atual@example.com',
      newEmail: 'novo@example.com',
      confirmationUrl: 'https://app.keeprone.com/api/auth/verify-email?token=old',
      language: 'PT',
    })
  })

  it('uses the real reset route and revokes sessions after password reset', () => {
    const options = mocks.betterAuth.mock.calls[0]?.[0]

    expect(options.emailAndPassword).toEqual(expect.objectContaining({
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    }))
    expect(options?.rateLimit?.customRules).toEqual(expect.objectContaining({
      '/request-password-reset': { window: 300, max: 3 },
      '/verify-password': { window: 900, max: 5 },
      '/change-email': { window: 900, max: 5 },
      '/change-password': { window: 900, max: 5 },
    }))
    expect(options?.rateLimit?.customRules).not.toHaveProperty('/forget-password')
  })
})
