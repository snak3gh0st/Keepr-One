import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  assertSameOriginAction: vi.fn(),
  requireRole: vi.fn(),
  requestPasswordReset: vi.fn(),
  getStripeCatalogEntry: vi.fn(),
  transaction: vi.fn(),
  pendingInvitationCheckout: vi.fn(),
  userCreate: vi.fn(),
  accountCreate: vi.fn(),
  agentCreate: vi.fn(),
  agencyCreate: vi.fn(),
  membershipCreate: vi.fn(),
  subscriptionCreate: vi.fn(),
  provisionedAccessCreate: vi.fn(),
  onboardingCreate: vi.fn(),
  transactionAuditCreate: vi.fn(),
  deliveryAuditCreate: vi.fn(),
}))

vi.mock('better-auth/crypto', () => ({ hashPassword: mocks.hashPassword }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
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
  auth: { api: { requestPasswordReset: mocks.requestPasswordReset } },
}))
vi.mock('@/lib/stripe/platform-catalog', () => ({
  getStripeCatalogEntry: mocks.getStripeCatalogEntry,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    auditLog: { create: mocks.deliveryAuditCreate },
  },
}))

import { createManagedUserAction } from './create-actions'

const ADMIN_ID = 'cm0h7x7qf0000abcde1234567'
const REQUEST_HEADERS = new Headers({
  origin: 'https://app.keeprone.com',
  host: 'app.keeprone.com',
  cookie: 'better-auth.session_token=admin-secret',
  authorization: 'Bearer admin-secret',
})
const AGENT_MODULES = [
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'INTEGRATIONS',
]
const AGENCY_MODULES = [...AGENT_MODULES.slice(0, -1), 'AGENCY', 'TEAM', 'INTEGRATIONS']
const INITIAL_STATE = { status: 'idle' as const, message: '' }

function createForm(overrides: Record<string, string | string[]> = {}) {
  const values: Record<string, string | string[]> = {
    accountType: 'AGENT_INDIVIDUAL',
    name: 'Maria Silva',
    agencyName: '',
    email: 'Maria@Example.com',
    phone: '+1 (305) 555-0100',
    language: 'PT',
    timeZone: 'America/New_York',
    npn: '1234567',
    accessMode: 'TRIAL',
    trialDays: '30',
    modules: AGENT_MODULES,
    sendAccessEmail: 'yes',
    ...overrides,
  }
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((entry) => data.append(key, entry))
    else data.set(key, value)
  }
  return data
}

describe('createManagedUserAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T16:00:00.000Z'))
    mocks.headers.mockResolvedValue(REQUEST_HEADERS)
    mocks.requireRole.mockResolvedValue({ user: { id: ADMIN_ID, name: 'Keepr Admin', role: 'ADMIN' } })
    mocks.hashPassword.mockResolvedValue('secure-random-password-hash')
    mocks.requestPasswordReset.mockResolvedValue({ status: true })
    mocks.getStripeCatalogEntry.mockImplementation((plan: string) => plan === 'AGENCY'
      ? {
          productId: 'prod_agency',
          priceId: 'price_agency',
          unitAmountCents: 9_990,
          currency: 'usd',
        }
      : {
          productId: 'prod_agent',
          priceId: 'price_agent',
          unitAmountCents: 5_990,
          currency: 'usd',
        })
    mocks.userCreate.mockResolvedValue({ id: 'user-created' })
    mocks.agentCreate.mockResolvedValue({ id: 'agent-created' })
    mocks.agencyCreate.mockResolvedValue({ id: 'agency-created' })
    mocks.subscriptionCreate.mockResolvedValue({ id: 'subscription-created' })
    mocks.provisionedAccessCreate.mockResolvedValue({ id: 'access-created' })
    mocks.pendingInvitationCheckout.mockResolvedValue(null)
    mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
      agencyInvitationCheckout: { findFirst: mocks.pendingInvitationCheckout },
      user: { create: mocks.userCreate },
      account: { create: mocks.accountCreate },
      agent: { create: mocks.agentCreate },
      agency: { create: mocks.agencyCreate },
      agencyMembership: { create: mocks.membershipCreate },
      platformSubscription: { create: mocks.subscriptionCreate },
      adminProvisionedAccess: { create: mocks.provisionedAccessCreate },
      agentOnboarding: { create: mocks.onboardingCreate },
      auditLog: { create: mocks.transactionAuditCreate },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates an individual trial atomically and sends a public password setup request', async () => {
    await createManagedUserAction(INITIAL_STATE, createForm())

    expect(mocks.assertSameOriginAction).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'https://app.keeprone.com',
      host: 'app.keeprone.com',
    }))
    expect(mocks.hashPassword).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/))
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: {
        email: 'maria@example.com',
        name: 'Maria Silva',
        role: 'AGENT',
        language: 'PT',
        timeZone: 'America/New_York',
      },
      select: { id: true },
    })
    expect(mocks.accountCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'user-created',
        providerId: 'credential',
        userId: 'user-created',
        password: 'secure-random-password-hash',
      }),
    })
    expect(mocks.agentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-created',
        rank: 'AGENT',
        phone: '+13055550100',
        promotionAccessScope: 'PERSONAL',
      }),
      select: { id: true },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENT_INDIVIDUAL',
        status: 'TRIALING',
        agentId: 'agent-created',
        unitAmountCents: 5_990,
        currency: 'USD',
        currentPeriodStart: new Date('2026-09-02T16:00:00.000Z'),
        currentPeriodEnd: new Date('2026-10-02T16:00:00.000Z'),
        stripeProductId: 'prod_agent',
        stripePriceId: 'price_agent',
      }),
      select: { id: true },
    })
    expect(mocks.provisionedAccessCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'agent-created',
        platformSubscriptionId: 'subscription-created',
        individualRank: 'AGENT',
        modules: AGENT_MODULES,
        paymentRequiredAt: null,
        paymentReason: null,
        provisionedById: ADMIN_ID,
      }),
      select: { id: true },
    })
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: {
        agentId: 'agent-created',
        status: 'IN_PROGRESS',
        currentStep: 'WELCOME',
        requiredModules: AGENT_MODULES,
      },
    })

    const passwordResetCall = mocks.requestPasswordReset.mock.calls[0][0]
    expect(passwordResetCall.body).toEqual({
      email: 'maria@example.com',
      redirectTo: '/reset-password?lang=PT',
    })
    expect(passwordResetCall.headers.get('cookie')).toBeNull()
    expect(passwordResetCall.headers.get('authorization')).toBeNull()
    expect(mocks.redirect).toHaveBeenCalledWith('/admin/users/user-created?created=1&email=sent')
  })

  it('creates an agency owner behind the payment gate without sending email when opted out', async () => {
    await createManagedUserAction(INITIAL_STATE, createForm({
      accountType: 'AGENCY',
      agencyName: 'North Star Agency',
      accessMode: 'PAYMENT_REQUIRED',
      modules: AGENCY_MODULES,
      sendAccessEmail: '',
    }))

    expect(mocks.agencyCreate).toHaveBeenCalledWith({
      data: { name: 'North Star Agency' },
      select: { id: true },
    })
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: { agencyId: 'agency-created', agentId: 'agent-created', role: 'OWNER' },
    })
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan: 'AGENCY',
        status: 'PAST_DUE',
        agencyId: 'agency-created',
        currentPeriodStart: null,
        currentPeriodEnd: null,
      }),
      select: { id: true },
    })
    expect(mocks.provisionedAccessCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentRequiredAt: new Date('2026-09-02T16:00:00.000Z'),
        paymentReason: 'INITIAL_PAYMENT_REQUIRED',
      }),
      select: { id: true },
    })
    expect(mocks.onboardingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requiredModules: [
          'TODAY',
          'CALENDAR',
          'CRM',
          'MESSAGES',
          'POLICIES',
          'ILLUSTRATIONS',
          'COMMISSIONS',
          'JOURNEY',
          'TEAM',
          'INTEGRATIONS',
        ],
      }),
    })
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
    expect(mocks.redirect).toHaveBeenCalledWith('/admin/users/user-created?created=1&email=skipped')
  })

  it('rejects missing Today and agency-only modules on an individual plan before writes', async () => {
    const result = await createManagedUserAction(INITIAL_STATE, createForm({
      modules: ['CALENDAR', 'TEAM'],
    }))

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { modules: expect.any(String) },
    })
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it.each(['AGENT_AGENCY_MEMBER', 'FREE'])('rejects the unsupported plan value %s before authentication or writes', async (accountType) => {
    const result = await createManagedUserAction(INITIAL_STATE, createForm({ accountType }))

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { accountType: 'Selecione um plano válido.' },
    })
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.hashPassword).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('returns a field error when the email already exists', async () => {
    mocks.transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['email'] },
      },
    ))

    await expect(createManagedUserAction(INITIAL_STATE, createForm())).resolves.toEqual({
      status: 'error',
      message: 'Não foi possível concluir o cadastro.',
      fieldErrors: { email: 'Já existe uma conta com este e-mail.' },
    })
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('does not create standalone access while an invitation checkout is pending', async () => {
    mocks.pendingInvitationCheckout.mockResolvedValue({ id: 'checkout-pending' })

    const result = await createManagedUserAction(INITIAL_STATE, createForm())

    expect(result).toEqual({
      status: 'error',
      message: 'Este e-mail já está concluindo um convite de Agência.',
      fieldErrors: {
        email: 'Aguarde o checkout expirar ou cancele o convite antes de criar o acesso avulso.',
      },
    })
    expect(mocks.pendingInvitationCheckout).toHaveBeenCalledWith({
      where: {
        email: 'maria@example.com',
        status: 'PENDING',
        checkoutExpiresAt: { gt: new Date('2026-09-02T16:00:00.000Z') },
      },
      select: { id: true },
    })
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled()
  })
})
