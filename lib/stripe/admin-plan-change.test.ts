import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  retrievePrice: vi.fn(),
}))

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    subscriptions: {
      retrieve: mocks.retrieveSubscription,
      update: mocks.updateSubscription,
    },
    prices: { retrieve: mocks.retrievePrice },
  }),
}))

import {
  migrateStripePlatformSubscriptionPlan,
  StripeAdminPlanChangeError,
} from './admin-plan-change'

const agentPrice = {
  id: 'price_1U8WGcGJWjOaP9iwo460bGLb',
  active: true,
  livemode: true,
  product: 'prod_V8noDGt2qhW2wq',
  currency: 'usd',
  unit_amount: 5_990,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
} as unknown as Stripe.Price

const agencyPrice = {
  id: 'price_1U8WGdGJWjOaP9iw43Kmiien',
  active: true,
  livemode: true,
  product: 'prod_V8noF7rVSveGUk',
  currency: 'usd',
  unit_amount: 9_990,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
} as unknown as Stripe.Price

function providerSubscription(
  price: Stripe.Price,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    schedule: null,
    metadata: {
      keeprOnePlatformSubscriptionId: 'local-sub-1',
      existingMetadata: 'preserved',
    },
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      data: [{
        id: 'si_1',
        quantity: 2,
        current_period_start: 1_788_220_200,
        current_period_end: 1_790_812_200,
        price,
      }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription
}

const input = {
  platformSubscriptionId: 'local-sub-1',
  stripeSubscriptionId: 'sub_1',
  currentPlan: 'AGENT_INDIVIDUAL' as const,
  targetPlan: 'AGENCY' as const,
  idempotencyKey: 'admin-plan-local-sub-1-v1',
}

const safeContext = {
  stripeSubscriptionId: 'sub_1',
  previousPriceId: agentPrice.id,
  targetPriceId: agencyPrice.id,
}

async function capturedError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(StripeAdminPlanChangeError)
    return error as StripeAdminPlanChangeError
  }
  throw new Error('Expected the promise to reject')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agentPrice))
  mocks.retrievePrice.mockImplementation(async (priceId: string) => (
    priceId === agentPrice.id ? agentPrice : agencyPrice
  ))
  mocks.updateSubscription.mockResolvedValue(providerSubscription(agencyPrice))
})

describe('admin Stripe plan migration', () => {
  it('moves the only item to the target price without proration and returns provider truth', async () => {
    const receipt = await migrateStripePlatformSubscriptionPlan(input)

    expect(mocks.retrieveSubscription).toHaveBeenCalledWith('sub_1', {
      expand: ['items.data.price.product'],
    })
    expect(mocks.retrievePrice).toHaveBeenCalledWith(agencyPrice.id, {
      expand: ['product'],
    })
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      'sub_1',
      {
        items: [{ id: 'si_1', price: agencyPrice.id, quantity: 2 }],
        proration_behavior: 'none',
        payment_behavior: 'error_if_incomplete',
        metadata: {
          keeprOnePlatformSubscriptionId: 'local-sub-1',
          existingMetadata: 'preserved',
        },
        expand: ['items.data.price.product'],
      },
      { idempotencyKey: input.idempotencyKey },
    )
    expect(receipt).toMatchObject({
      changed: true,
      previousPriceId: agentPrice.id,
      targetPriceId: agencyPrice.id,
      provider: {
        status: 'ACTIVE',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        stripeProductId: 'prod_V8noF7rVSveGUk',
        stripePriceId: agencyPrice.id,
        unitAmountCents: 9_990,
        currency: 'USD',
        currentPeriodStart: new Date(1_788_220_200_000),
        currentPeriodEnd: new Date(1_790_812_200_000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    })
  })

  it('can restore the previous plan when Stripe already has an orphaned target price', async () => {
    mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agencyPrice))
    mocks.updateSubscription.mockResolvedValue(providerSubscription(agentPrice))

    const receipt = await migrateStripePlatformSubscriptionPlan(input)

    expect(receipt.changed).toBe(false)
    expect(receipt.provider.stripePriceId).toBe(agencyPrice.id)
    expect(mocks.retrievePrice).not.toHaveBeenCalled()
    expect(mocks.updateSubscription).not.toHaveBeenCalled()

    await expect(receipt.rollback()).resolves.toMatchObject({
      stripePriceId: agentPrice.id,
      unitAmountCents: 5_990,
    })
    expect(mocks.retrievePrice).toHaveBeenCalledWith(agentPrice.id, {
      expand: ['product'],
    })
    expect(mocks.updateSubscription).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        items: [{ id: 'si_1', price: agentPrice.id, quantity: 2 }],
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^keeprone-admin-plan-rollback-[a-f0-9]{64}$/,
        ),
      },
    )
  })

  it('restores the previous Stripe price through a stable compensating operation', async () => {
    mocks.updateSubscription
      .mockResolvedValueOnce(providerSubscription(agencyPrice))
      .mockResolvedValueOnce(providerSubscription(agentPrice))

    const receipt = await migrateStripePlatformSubscriptionPlan(input)
    const restored = await receipt.rollback()

    expect(restored.stripePriceId).toBe(agentPrice.id)
    expect(mocks.updateSubscription).toHaveBeenNthCalledWith(
      2,
      'sub_1',
      expect.objectContaining({
        items: [{ id: 'si_1', price: agentPrice.id, quantity: 2 }],
        proration_behavior: 'none',
        payment_behavior: 'error_if_incomplete',
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^keeprone-admin-plan-rollback-[a-f0-9]{64}$/,
        ),
      },
    )
  })

  it('rejects subscriptions without the local mapping or mapped to another record', async () => {
    mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agentPrice, {
      metadata: {},
    }))
    const unmapped = await capturedError(migrateStripePlatformSubscriptionPlan(input))
    expect(unmapped).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_UNMAPPED',
      stage: 'current',
    })

    mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agentPrice, {
      metadata: { keeprOnePlatformSubscriptionId: 'different-local-sub' },
    }))
    const conflict = await capturedError(migrateStripePlatformSubscriptionPlan(input))
    expect(conflict).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_CONFLICT',
      stage: 'current',
    })
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('blocks direct updates while a Stripe subscription schedule owns the plan', async () => {
    mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agentPrice, {
      schedule: 'sub_sched_1',
    }))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_SCHEDULED',
      stage: 'current',
    })
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('rejects multi-item subscriptions and catalog mismatches before changing Stripe', async () => {
    mocks.retrieveSubscription.mockResolvedValue(providerSubscription(agentPrice, {
      items: {
        data: [
          providerSubscription(agentPrice).items.data[0],
          { ...providerSubscription(agentPrice).items.data[0], id: 'si_2' },
        ],
      },
    }))
    const multipleItems = await capturedError(
      migrateStripePlatformSubscriptionPlan(input),
    )
    expect(multipleItems).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage: 'current',
    })

    mocks.retrieveSubscription.mockResolvedValue(providerSubscription({
      ...agentPrice,
      unit_amount: 4_990,
    } as Stripe.Price))
    const badCurrentPrice = await capturedError(
      migrateStripePlatformSubscriptionPlan(input),
    )
    expect(badCurrentPrice).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage: 'current',
    })
    expect(mocks.updateSubscription).not.toHaveBeenCalled()
  })

  it('fails closed when retries fail and an immediate read still shows the previous price', async () => {
    mocks.updateSubscription.mockRejectedValue(new Error('Stripe unavailable'))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      stage: 'recovery',
      context: safeContext,
    })
    expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(2)
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(3)
  })

  it('retries with the same idempotency key and returns success from a later response', async () => {
    mocks.updateSubscription.mockRejectedValueOnce(new Error('Request timed out'))

    const receipt = await migrateStripePlatformSubscriptionPlan(input)

    expect(receipt).toMatchObject({
      changed: true,
      previousPriceId: agentPrice.id,
      targetPriceId: agencyPrice.id,
      provider: {
        stripeSubscriptionId: 'sub_1',
        stripePriceId: agencyPrice.id,
        unitAmountCents: 9_990,
      },
    })
    expect(typeof receipt.rollback).toBe('function')
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(2)
    expect(mocks.updateSubscription.mock.calls[0]?.[2]).toEqual({
      idempotencyKey: input.idempotencyKey,
    })
    expect(mocks.updateSubscription.mock.calls[1]?.[2]).toEqual({
      idempotencyKey: input.idempotencyKey,
    })
    expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(1)
  })

  it('returns a compensatable receipt when recovery finds the target after all retries time out', async () => {
    mocks.retrieveSubscription
      .mockResolvedValueOnce(providerSubscription(agentPrice))
      .mockResolvedValueOnce(providerSubscription(agencyPrice))
    mocks.updateSubscription.mockRejectedValue(new Error('Request timed out'))

    const receipt = await migrateStripePlatformSubscriptionPlan(input)

    expect(receipt).toMatchObject({
      changed: true,
      provider: { stripePriceId: agencyPrice.id },
    })
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(3)
    expect(mocks.retrieveSubscription).toHaveBeenCalledTimes(2)
  })

  it('requires reconciliation when the provider state cannot be recovered after an error', async () => {
    mocks.retrieveSubscription
      .mockResolvedValueOnce(providerSubscription(agentPrice))
      .mockRejectedValueOnce(new Error('Recovery timed out'))
    mocks.updateSubscription.mockRejectedValue(new Error('Update timed out'))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      stage: 'recovery',
      context: safeContext,
    })
  })

  it('requires reconciliation when recovery finds neither known catalogue price', async () => {
    const foreignPrice = {
      ...agentPrice,
      id: 'price_foreign',
    } as Stripe.Price
    mocks.retrieveSubscription
      .mockResolvedValueOnce(providerSubscription(agentPrice))
      .mockResolvedValueOnce(providerSubscription(foreignPrice))
    mocks.updateSubscription.mockRejectedValue(new Error('Update timed out'))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      stage: 'recovery',
      context: safeContext,
    })
  })

  it('rolls Stripe back internally when the updated response fails validation', async () => {
    const malformedResponse = providerSubscription({
      ...agencyPrice,
      unit_amount: 5_000,
    } as Stripe.Price)
    mocks.updateSubscription
      .mockResolvedValueOnce(malformedResponse)
      .mockResolvedValueOnce(providerSubscription(agentPrice))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage: 'response',
    })
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(2)
    expect(mocks.updateSubscription.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        items: [{ id: 'si_1', price: agentPrice.id, quantity: 2 }],
      }),
    )
  })

  it('signals manual reconciliation when response validation and rollback both fail', async () => {
    mocks.updateSubscription
      .mockResolvedValueOnce(providerSubscription({
        ...agencyPrice,
        unit_amount: 5_000,
      } as Stripe.Price))
      .mockRejectedValueOnce(new Error('Rollback unavailable'))

    const error = await capturedError(migrateStripePlatformSubscriptionPlan(input))

    expect(error).toMatchObject({
      code: 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      stage: 'rollback',
      context: safeContext,
    })
  })
})
