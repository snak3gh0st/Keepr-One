import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  requireRole: vi.fn(),
  findAccess: vi.fn(),
  createAgency: vi.fn(),
  createMembership: vi.fn(),
  endMembership: vi.fn(),
  cancelSubscription: vi.fn(),
  createSubscription: vi.fn(),
  updateAccess: vi.fn(),
  updateAgent: vi.fn(),
  createAudit: vi.fn(),
  createReconciliationAudit: vi.fn(),
  lockPlanChange: vi.fn(),
  revalidatePath: vi.fn(),
  assertSameOrigin: vi.fn(),
  migrateStripePlan: vi.fn(),
  rollbackStripePlan: vi.fn(),
  StripeAdminPlanChangeError: class StripeAdminPlanChangeError extends Error {
    constructor(
      readonly code: string,
      readonly stage: string,
      options?: { cause?: unknown },
      readonly context: {
        stripeSubscriptionId: string
        previousPriceId: string
        targetPriceId: string
      } | null = null,
    ) {
      super(code, options)
    }
  },
  sequence: [] as string[],
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.assertSameOrigin,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({ copy: (portuguese: string) => portuguese }),
}))
vi.mock('@/lib/stripe/platform-catalog', () => ({
  getStripeCatalogEntry: (plan: string) => plan === 'AGENCY'
    ? { productId: 'prod_agency', priceId: 'price_agency', unitAmountCents: 9_990, currency: 'usd' }
    : { productId: 'prod_agent', priceId: 'price_agent', unitAmountCents: 5_990, currency: 'usd' },
}))
vi.mock('@/lib/stripe/admin-plan-change', () => ({
  StripeAdminPlanChangeError: mocks.StripeAdminPlanChangeError,
  migrateStripePlatformSubscriptionPlan: mocks.migrateStripePlan,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { create: mocks.createReconciliationAudit },
    $transaction: async (callback: (transaction: unknown) => unknown) => callback({
      $queryRaw: mocks.lockPlanChange,
      adminProvisionedAccess: {
        findFirst: mocks.findAccess,
        updateMany: mocks.updateAccess,
      },
      agency: { create: mocks.createAgency },
      agencyMembership: {
        create: mocks.createMembership,
        updateMany: mocks.endMembership,
      },
      platformSubscription: {
        updateMany: mocks.cancelSubscription,
        create: mocks.createSubscription,
      },
      agent: { updateMany: mocks.updateAgent },
      auditLog: { create: mocks.createAudit },
    }),
  },
}))

import { updateManagedUserPlanAction } from './plan-actions'

const userId = 'cm12345678901234567890123'
const accessUpdatedAt = new Date('2026-09-02T18:00:00.000Z')
const subscriptionUpdatedAt = new Date('2026-09-02T17:00:00.000Z')
const agentUpdatedAt = new Date('2026-09-02T16:00:00.000Z')

function individualAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: 'access-1',
    updatedAt: accessUpdatedAt,
    individualRank: 'MANAGER',
    modules: ['TODAY', 'CRM'],
    paymentRequiredAt: null,
    paymentReason: null,
    agent: {
      id: 'agent-1',
      updatedAt: agentUpdatedAt,
      rank: 'MANAGER',
      promotionAccessScope: 'PERSONAL',
      parentAgentId: null,
      _count: { subAgents: 0 },
      agencyInvitationsAccepted: [],
      agencyMemberships: [],
    },
    platformSubscription: {
      id: 'subscription-agent',
      plan: 'AGENT_INDIVIDUAL',
      status: 'TRIALING',
      agentId: 'agent-1',
      agencyId: null,
      agencyMembershipId: null,
      unitAmountCents: 5_990,
      currency: 'USD',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeProductId: 'prod_agent',
      stripePriceId: 'price_agent',
      updatedAt: subscriptionUpdatedAt,
    },
    ...overrides,
  }
}

function agencyAccess(overrides: Record<string, unknown> = {}) {
  const base = individualAccess()
  return {
    ...base,
    modules: ['TODAY', 'CRM', 'AGENCY', 'TEAM'],
    agent: {
      ...base.agent,
      rank: 'AGENCY_OWNER',
      promotionAccessScope: 'AGENCY',
      agencyMemberships: [{
        id: 'membership-owner',
        agencyId: 'agency-1',
        agentId: 'agent-1',
        role: 'OWNER',
        agency: {
          id: 'agency-1',
          name: 'Northstar Agency',
          parentAgencyId: null,
          _count: { memberships: 1, childAgencies: 0 },
          invitations: [],
        },
      }],
    },
    platformSubscription: {
      ...base.platformSubscription,
      id: 'subscription-agency',
      plan: 'AGENCY',
      agentId: null,
      agencyId: 'agency-1',
      unitAmountCents: 9_990,
      stripeProductId: 'prod_agency',
      stripePriceId: 'price_agency',
    },
    ...overrides,
  }
}

function form(targetPlan: 'AGENT_INDIVIDUAL' | 'AGENCY') {
  const data = new FormData()
  data.set('userId', userId)
  data.set('expectedUpdatedAt', accessUpdatedAt.toISOString())
  data.set('targetPlan', targetPlan)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sequence.length = 0
  mocks.headers.mockResolvedValue(new Headers({ origin: 'https://app.test', host: 'app.test' }))
  mocks.requireRole.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.findAccess.mockResolvedValue(individualAccess())
  mocks.createAgency.mockImplementation(async () => {
    mocks.sequence.push('create-agency')
    return { id: 'agency-new' }
  })
  mocks.createMembership.mockImplementation(async () => {
    mocks.sequence.push('create-owner')
    return { id: 'membership-new' }
  })
  mocks.endMembership.mockImplementation(async () => {
    mocks.sequence.push('end-owner')
    return { count: 1 }
  })
  mocks.cancelSubscription.mockImplementation(async (args) => {
    mocks.sequence.push(args.data.status === 'CANCELED'
      ? 'cancel-old-subscription'
      : 'update-provider-subscription')
    return { count: 1 }
  })
  mocks.createSubscription.mockImplementation(async () => {
    mocks.sequence.push('create-new-subscription')
    return { id: 'subscription-new' }
  })
  mocks.updateAccess.mockResolvedValue({ count: 1 })
  mocks.updateAgent.mockResolvedValue({ count: 1 })
  mocks.createAudit.mockResolvedValue({})
  mocks.createReconciliationAudit.mockResolvedValue({})
  mocks.lockPlanChange.mockResolvedValue([{ pg_advisory_xact_lock: null }])
  mocks.rollbackStripePlan.mockResolvedValue(undefined)
  mocks.migrateStripePlan.mockResolvedValue({
    changed: true,
    previousPriceId: 'price_agent',
    targetPriceId: 'price_agency',
    provider: {
      status: 'ACTIVE',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      stripeProductId: 'prod_agency',
      stripePriceId: 'price_agency',
      unitAmountCents: 9_990,
      currency: 'USD',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
    rollback: mocks.rollbackStripePlan,
  })
})

describe('managed user plan action', () => {
  it('upgrades an individual account and creates its agency structure atomically', async () => {
    const data = form('AGENCY')
    data.set('agencyName', '  Northstar Agency  ')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('success')
    expect(mocks.createAgency).toHaveBeenCalledWith({
      data: { name: 'Northstar Agency' },
      select: { id: true },
    })
    expect(mocks.createMembership).toHaveBeenCalledWith(expect.objectContaining({
      data: { agencyId: 'agency-new', agentId: 'agent-1', role: 'OWNER' },
    }))
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan: 'AGENCY',
        agencyId: 'agency-new',
        status: 'TRIALING',
        unitAmountCents: 9_990,
        stripeProductId: 'prod_agency',
        stripePriceId: 'price_agency',
      }),
    }))
    expect(mocks.updateAccess).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        platformSubscriptionId: 'subscription-new',
        modules: ['TODAY', 'CRM', 'AGENCY', 'TEAM'],
        individualRank: 'MANAGER',
      }),
    }))
    expect(mocks.updateAgent).toHaveBeenCalledWith(expect.objectContaining({
      data: { rank: 'AGENCY_OWNER', promotionAccessScope: 'AGENCY' },
    }))
    expect(mocks.createAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ADMIN_USER_PLAN_CHANGED',
        entity: 'User',
        entityId: userId,
      }),
    }))
  })

  it('downgrades an empty agency only after canceling its plan and ends the owner link', async () => {
    mocks.findAccess.mockResolvedValue(agencyAccess())
    const data = form('AGENT_INDIVIDUAL')
    data.set('confirmDowngrade', 'yes')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('success')
    expect(mocks.sequence).toEqual([
      'cancel-old-subscription',
      'end-owner',
      'create-new-subscription',
    ])
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan: 'AGENT_INDIVIDUAL',
        agentId: 'agent-1',
        unitAmountCents: 5_990,
      }),
    }))
    expect(mocks.updateAccess).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ modules: ['TODAY', 'CRM'] }),
    }))
    expect(mocks.updateAgent).toHaveBeenCalledWith(expect.objectContaining({
      data: { rank: 'MANAGER', promotionAccessScope: 'PERSONAL' },
    }))
  })

  it('requires an agency name before creating any structure', async () => {
    const result = await updateManagedUserPlanAction(
      { status: 'idle', message: '' },
      form('AGENCY'),
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      fieldErrors: { agencyName: 'Informe o nome da nova agência.' },
    }))
    expect(mocks.requireRole).toHaveBeenCalled()
    expect(mocks.createAgency).not.toHaveBeenCalled()
  })

  it('migrates a Stripe-managed subscription and its local subject together', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('success')
    expect(mocks.migrateStripePlan).toHaveBeenCalledWith(expect.objectContaining({
      platformSubscriptionId: 'subscription-agent',
      stripeSubscriptionId: 'sub_1',
      currentPlan: 'AGENT_INDIVIDUAL',
      targetPlan: 'AGENCY',
      idempotencyKey: `keeprone-admin-plan-change:access-1:${accessUpdatedAt.toISOString()}:AGENCY`,
    }))
    expect(mocks.cancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plan: 'AGENCY',
        agencyId: 'agency-new',
        stripePriceId: 'price_agency',
      }),
    }))
    expect(mocks.createSubscription).not.toHaveBeenCalled()
    expect(mocks.rollbackStripePlan).not.toHaveBeenCalled()
  })

  it('blocks a Stripe customer without a linked subscription', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
      },
    })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('ainda não tem uma assinatura')
    expect(mocks.migrateStripePlan).not.toHaveBeenCalled()
  })

  it('restores the previous Stripe price when the local transaction cannot commit', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    })
    mocks.cancelSubscription.mockResolvedValue({ count: 0 })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(mocks.rollbackStripePlan).toHaveBeenCalledOnce()
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('treats a concurrently adopted Stripe plan as success without undoing it', async () => {
    const current = individualAccess()
    const stripeCurrent = {
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    }
    mocks.findAccess
      .mockResolvedValueOnce(stripeCurrent)
      .mockResolvedValueOnce({
        ...stripeCurrent,
        platformSubscription: {
          ...stripeCurrent.platformSubscription,
          plan: 'AGENCY',
          stripePriceId: 'price_agency',
        },
      })
    mocks.cancelSubscription.mockResolvedValue({ count: 0 })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('success')
    expect(result.message).toContain('outra solicitação')
    expect(mocks.rollbackStripePlan).not.toHaveBeenCalled()
  })

  it('records a durable audit event when Stripe compensation fails', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    })
    mocks.cancelSubscription.mockResolvedValue({ count: 0 })
    mocks.rollbackStripePlan.mockRejectedValue(new Error('Stripe unavailable'))
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('revisão manual')
    expect(mocks.createReconciliationAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ADMIN_USER_PLAN_RECONCILIATION_REQUIRED',
        entityId: userId,
      }),
    }))
  })

  it('keeps provider identifiers in the audit when Stripe recovery is uncertain', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    })
    mocks.migrateStripePlan.mockRejectedValue(new mocks.StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      'recovery',
      { cause: new Error('Provider state unavailable') },
      {
        stripeSubscriptionId: 'sub_1',
        previousPriceId: 'price_agent',
        targetPriceId: 'price_agency',
      },
    ))
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('revisão manual')
    expect(mocks.createReconciliationAudit).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        before: { plan: 'AGENT_INDIVIDUAL', stripePriceId: 'price_agent' },
        after: {
          plan: 'AGENCY',
          stripeSubscriptionId: 'sub_1',
          stripePriceId: 'price_agency',
          reconciliationStatus: 'MANUAL_REVIEW_REQUIRED',
        },
      }),
    }))
  })

  it('blocks an agency downgrade while team members are active', async () => {
    const current = agencyAccess()
    const membership = current.agent.agencyMemberships[0]!
    mocks.findAccess.mockResolvedValue({
      ...current,
      agent: {
        ...current.agent,
        agencyMemberships: [{
          ...membership,
          agency: { ...membership.agency, _count: { memberships: 2, childAgencies: 0 } },
        }],
      },
    })
    const data = form('AGENT_INDIVIDUAL')
    data.set('confirmDowngrade', 'yes')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('membros ativos')
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
  })

  it('checks all structural blockers before changing a Stripe price', async () => {
    const current = agencyAccess()
    const membership = current.agent.agencyMemberships[0]!
    mocks.findAccess.mockResolvedValue({
      ...current,
      agent: {
        ...current.agent,
        agencyMemberships: [{
          ...membership,
          agency: { ...membership.agency, _count: { memberships: 2, childAgencies: 0 } },
        }],
      },
      platformSubscription: {
        ...current.platformSubscription,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
      },
    })
    const data = form('AGENT_INDIVIDUAL')
    data.set('confirmDowngrade', 'yes')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(mocks.migrateStripePlan).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before ending an agency', async () => {
    mocks.findAccess.mockResolvedValue(agencyAccess())

    const result = await updateManagedUserPlanAction(
      { status: 'idle', message: '' },
      form('AGENT_INDIVIDUAL'),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('Confirme')
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
  })

  it('uses optimistic concurrency for both access and subscription changes', async () => {
    mocks.cancelSubscription.mockResolvedValue({ count: 0 })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('durante a operação')
    expect(mocks.createSubscription).not.toHaveBeenCalled()
  })

  it('does not overwrite product access loaded from an older editor snapshot', async () => {
    mocks.findAccess.mockResolvedValue(individualAccess({
      updatedAt: new Date('2026-09-02T19:00:00.000Z'),
    }))
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('outra sessão')
    expect(mocks.createAgency).not.toHaveBeenCalled()
  })

  it('treats selecting the current plan as a no-op', async () => {
    mocks.findAccess.mockResolvedValue(agencyAccess())

    const result = await updateManagedUserPlanAction(
      { status: 'idle', message: '' },
      form('AGENCY'),
    )

    expect(result.status).toBe('error')
    expect(result.message).toContain('já está no plano')
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
  })

  it('blocks a downgrade while an invitation or checkout is pending', async () => {
    const current = agencyAccess()
    const membership = current.agent.agencyMemberships[0]!
    mocks.findAccess.mockResolvedValue({
      ...current,
      agent: {
        ...current.agent,
        agencyMemberships: [{
          ...membership,
          agency: { ...membership.agency, invitations: [{ id: 'invitation-1' }] },
        }],
      },
    })
    const data = form('AGENT_INDIVIDUAL')
    data.set('confirmDowngrade', 'yes')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('convites pendentes')
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
  })

  it('rejects invitation-only plans even if a malformed admin access points to one', async () => {
    const current = individualAccess()
    mocks.findAccess.mockResolvedValue({
      ...current,
      platformSubscription: {
        ...current.platformSubscription,
        plan: 'AGENT_AGENCY_MEMBER',
        agentId: null,
        agencyMembershipId: 'member-1',
      },
    })
    const data = form('AGENCY')
    data.set('agencyName', 'Northstar Agency')

    const result = await updateManagedUserPlanAction({ status: 'idle', message: '' }, data)

    expect(result.status).toBe('error')
    expect(result.message).toContain('fluxo comercial próprio')
    expect(mocks.cancelSubscription).not.toHaveBeenCalled()
  })
})
