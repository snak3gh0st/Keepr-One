import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  headers: vi.fn(),
  sendFounderWelcomeEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  agentCreate: vi.fn(),
  agencyCreate: vi.fn(),
  membershipCreate: vi.fn(),
  subscriptionCreate: vi.fn(),
  enrollmentCreate: vi.fn(),
  onboardingCreate: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock('better-auth/crypto', () => ({ hashPassword: mocks.hashPassword }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/lib/email/send', () => ({
  sendFounderWelcomeEmail: mocks.sendFounderWelcomeEmail,
}))
vi.mock('@/lib/founder-access', () => ({
  FOUNDER_TRIAL_DURATION_MS: 2_592_000_000,
}))
vi.mock('@/lib/founder-rate-limit', () => ({
  consumeFounderRegistrationRateLimit: mocks.consumeRateLimit,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import { registerFounderAction } from './actions'

function registrationForm(overrides: Record<string, string> = {}) {
  const values = {
    accountType: 'AGENT',
    name: 'Maria Founder',
    agencyName: '',
    email: 'Maria@Example.com',
    phone: '+1 (305) 555-0100',
    npn: '1234567',
    password: 'senha-segura-123',
    confirmPassword: 'senha-segura-123',
    acceptedTerms: 'on',
    accessCode: 'FOUNDERS-SECRET',
    website: '',
    ...overrides,
  }
  const formData = new FormData()
  Object.entries(values).forEach(([key, value]) => formData.set(key, value))
  return formData
}

describe('registerFounderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('FOUNDERS_ACCESS_CODE', 'FOUNDERS-SECRET')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T15:00:00.000Z'))

    mocks.hashPassword.mockResolvedValue('better-auth-password-hash')
    mocks.headers.mockResolvedValue(new Headers({ 'x-forwarded-for': '203.0.113.8' }))
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true })
    mocks.sendFounderWelcomeEmail.mockResolvedValue(undefined)
    mocks.userCreate.mockResolvedValue({ id: 'user-founder' })
    mocks.agentCreate.mockResolvedValue({ id: 'agent-founder' })
    mocks.agencyCreate.mockResolvedValue({ id: 'agency-founder' })
    mocks.enrollmentCreate.mockResolvedValue({ id: 'enrollment-founder' })
    mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
      user: { create: mocks.userCreate },
      account: { create: mocks.accountCreate },
      agent: { create: mocks.agentCreate },
      agency: { create: mocks.agencyCreate },
      agencyMembership: { create: mocks.membershipCreate },
      platformSubscription: { create: mocks.subscriptionCreate },
      founderEnrollment: { create: mocks.enrollmentCreate },
      agentOnboarding: { create: mocks.onboardingCreate },
      auditLog: { create: mocks.auditCreate },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('creates an atomic individual account with a Better Auth credential and exact trial', async () => {
    const result = await registerFounderAction(registrationForm())

    expect(result).toEqual({
      ok: true,
      email: 'maria@example.com',
      loginUrl: 'http://localhost:3000/login?founder=created&email=maria%40example.com',
      trialEndsAt: '2026-09-25T15:00:00.000Z',
    })
    expect(mocks.hashPassword).toHaveBeenCalledWith('senha-segura-123')
    expect(mocks.accountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'user-founder',
        providerId: 'credential',
        userId: 'user-founder',
        password: 'better-auth-password-hash',
      }),
    })
    expect(mocks.agentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '+13055550100',
      }),
      select: { id: true },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENT_INDIVIDUAL',
        status: 'TRIALING',
        agentId: 'agent-founder',
        unitAmountCents: 5_990,
        currentPeriodStart: new Date('2026-08-26T15:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-25T15:00:00.000Z'),
      }),
    })
    expect(mocks.enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-founder',
        agencyId: null,
        accountType: 'AGENT',
        phone: '+13055550100',
      }),
      select: { id: true },
    })
    expect(mocks.agencyCreate).not.toHaveBeenCalled()
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-founder',
        status: 'IN_PROGRESS',
        currentStep: 'WELCOME',
        requiredModules: [
          'TODAY',
          'CALENDAR',
          'CRM',
          'MESSAGES',
          'POLICIES',
          'ILLUSTRATIONS',
          'COMMISSIONS',
          'JOURNEY',
          'INTEGRATIONS',
        ],
      },
    })
    expect(mocks.sendFounderWelcomeEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'maria@example.com',
      accountType: 'AGENT',
    }))
  })

  it('creates an agency owner, membership and agency-subject trial', async () => {
    const result = await registerFounderAction(registrationForm({
      accountType: 'AGENCY',
      agencyName: 'North Star Agency',
    }))

    expect(result.ok).toBe(true)
    expect(mocks.agentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rank: 'AGENCY_OWNER',
        promotionAccessScope: 'AGENCY',
      }),
      select: { id: true },
    })
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: {
        agencyId: 'agency-founder',
        agentId: 'agent-founder',
        role: 'OWNER',
      },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENCY',
        status: 'TRIALING',
        agencyId: 'agency-founder',
        unitAmountCents: 9_990,
      }),
    })
    expect(mocks.enrollmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountType: 'AGENCY',
        agencyId: 'agency-founder',
      }),
      select: { id: true },
    })
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-founder',
        requiredModules: expect.arrayContaining(['TEAM', 'INTEGRATIONS']),
      }),
    })
  })

  it('fails closed when registration is not configured or the invite code is wrong', async () => {
    vi.stubEnv('FOUNDERS_ACCESS_CODE', '')
    await expect(registerFounderAction(registrationForm())).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('pausadas'),
    })

    vi.stubEnv('FOUNDERS_ACCESS_CODE', 'FOUNDERS-SECRET')
    await expect(registerFounderAction(registrationForm({ accessCode: 'wrong' }))).resolves.toEqual({
      ok: false,
      fieldErrors: { accessCode: ['Código inválido. Confira o convite recebido.'] },
    })
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns field-specific validation without performing expensive work', async () => {
    const result = await registerFounderAction(registrationForm({
      accountType: 'AGENCY',
      agencyName: '',
      email: 'invalid',
      confirmPassword: 'different-password',
    }))

    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        agencyName: expect.any(Array),
        email: expect.any(Array),
        confirmPassword: expect.any(Array),
      },
    })
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rate-limits before hashing or opening a transaction', async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 })

    await expect(registerFounderAction(registrationForm())).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('Muitas tentativas'),
    })
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('uses X-Real-IP ahead of a client-prepended X-Forwarded-For entry for rate limiting', async () => {
    mocks.headers.mockResolvedValue(new Headers({
      'x-forwarded-for': '198.51.100.8, 203.0.113.8',
      'x-real-ip': '203.0.113.7',
    }))

    await registerFounderAction(registrationForm())

    expect(mocks.consumeRateLimit).toHaveBeenNthCalledWith(1, {
      key: 'founders-register-ip:fec52565aa0cf18f57d7cf5b3ac72850',
      max: 12,
      windowSeconds: 60 * 60,
    })
  })

  it('rejects a concurrently redeemed one-time invite', async () => {
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['accessCodeHash'] },
      },
    ))

    await expect(registerFounderAction(registrationForm())).resolves.toEqual({
      ok: false,
      fieldErrors: {
        accessCode: ['Este convite já foi utilizado. Peça um novo código à Keepr One.'],
      },
    })
  })
})
