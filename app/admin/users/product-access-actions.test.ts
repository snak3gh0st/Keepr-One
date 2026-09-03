import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  requireRole: vi.fn(),
  findAccess: vi.fn(),
  updateAccess: vi.fn(),
  updateSubscription: vi.fn(),
  createAudit: vi.fn(),
  revalidatePath: vi.fn(),
  assertSameOrigin: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.assertSameOrigin,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    copy: (portuguese: string) => portuguese,
  }),
}))
vi.mock('@/lib/auth', () => ({ auth: { api: {} } }))
vi.mock('@/lib/ranks', () => ({ RANKS: ['AGENT'] }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminProvisionedAccess: { findFirst: mocks.findAccess },
    $transaction: async (callback: (transaction: unknown) => unknown) => callback({
      adminProvisionedAccess: { updateMany: mocks.updateAccess },
      platformSubscription: { updateMany: mocks.updateSubscription },
      auditLog: { create: mocks.createAudit },
    }),
  },
}))

import { updateManagedUserProductAccessAction } from './actions'

const userId = 'cm12345678901234567890123'
const updatedAt = new Date('2026-09-02T16:00:00.000Z')

function currentAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: 'access-1',
    updatedAt,
    modules: ['TODAY', 'CRM'],
    paymentRequiredAt: null,
    paymentReason: null,
    platformSubscription: {
      id: 'subscription-1',
      plan: 'AGENT_INDIVIDUAL',
      status: 'TRIALING',
      currentPeriodStart: new Date('2026-09-01T12:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T12:00:00.000Z'),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      updatedAt: new Date('2026-09-02T15:59:00.000Z'),
    },
    ...overrides,
  }
}

function form(intent: string) {
  const data = new FormData()
  data.set('userId', userId)
  data.set('expectedUpdatedAt', updatedAt.toISOString())
  data.set('intent', intent)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(new Headers({ origin: 'https://app.test', host: 'app.test' }))
  mocks.requireRole.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.findAccess.mockResolvedValue(currentAccess())
  mocks.updateAccess.mockResolvedValue({ count: 1 })
  mocks.updateSubscription.mockResolvedValue({ count: 1 })
  mocks.createAudit.mockResolvedValue({})
})

describe('managed product access actions', () => {
  it('updates only whitelisted modules and preserves TODAY', async () => {
    const data = form('SAVE_MODULES')
    data.append('modules', 'TODAY')
    data.append('modules', 'CALENDAR')
    data.append('modules', 'CRM')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result.status).toBe('success')
    expect(mocks.updateAccess).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ modules: ['TODAY', 'CALENDAR', 'CRM'] }),
    }))
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'ADMIN_USER_MODULES_UPDATED' }),
    }))
  })

  it('starts a custom trial and clears the payment hold atomically', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T18:00:00.000Z'))
    const data = form('START_TRIAL')
    data.set('trialDays', '14')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result.status).toBe('success')
    expect(mocks.updateAccess).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentRequiredAt: null, paymentReason: null }),
    }))
    expect(mocks.updateSubscription).toHaveBeenCalledWith({
      where: {
        id: 'subscription-1',
        updatedAt: new Date('2026-09-02T15:59:00.000Z'),
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      },
      data: expect.objectContaining({
        status: 'TRIALING',
        currentPeriodStart: new Date('2026-09-02T18:00:00.000Z'),
        currentPeriodEnd: new Date('2026-09-16T18:00:00.000Z'),
      }),
    })
    vi.useRealTimers()
  })

  it('requires payment without suspending login', async () => {
    const data = form('REQUIRE_PAYMENT')
    data.set('reason', 'Período de teste encerrado')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result.status).toBe('success')
    expect(mocks.updateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAST_DUE' }),
    }))
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'ADMIN_USER_PAYMENT_REQUIRED' }),
    }))
  })

  it('does not mutate Stripe-managed billing locally', async () => {
    mocks.findAccess.mockResolvedValue(currentAccess({
      platformSubscription: {
        ...currentAccess().platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    }))
    const data = form('START_TRIAL')
    data.set('trialDays', '30')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result.status).toBe('error')
    expect(mocks.updateAccess).not.toHaveBeenCalled()
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('rejects agency-only modules on an individual plan', async () => {
    const data = form('SAVE_MODULES')
    data.append('modules', 'TODAY')
    data.append('modules', 'AGENCY')
    data.append('modules', 'TEAM')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      fieldErrors: { modules: 'Agência e Equipe exigem o plano Agência.' },
    }))
    expect(mocks.updateAccess).not.toHaveBeenCalled()
  })

  it('does not overwrite a subscription changed concurrently', async () => {
    mocks.updateSubscription.mockResolvedValue({ count: 0 })
    const data = form('START_TRIAL')
    data.set('trialDays', '30')

    const result = await updateManagedUserProductAccessAction(
      { status: 'idle', message: '' },
      data,
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('outra sessão')
  })
})
