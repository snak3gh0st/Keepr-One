import 'server-only'

import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import type { PlatformPlanName } from '@/lib/plans'
import { getStripeClient } from './client'
import {
  assertStripePriceMatchesPlan,
  getStripeCatalogEntry,
  type StripePlatformCatalogEntry,
} from './platform-catalog'
import { toPlatformSubscriptionStatus } from './platform-subscription'

export type AdminStripePlan = Extract<PlatformPlanName, 'AGENT_INDIVIDUAL' | 'AGENCY'>

export type StripeAdminPlanChangeErrorCode =
  | 'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_UNMAPPED'
  | 'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_CONFLICT'
  | 'STRIPE_ADMIN_PLAN_CHANGE_SCHEDULED'
  | 'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID'
  | 'STRIPE_ADMIN_PLAN_CHANGE_UPDATE_FAILED'
  | 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED'

export type StripeAdminPlanChangeStage =
  | 'input'
  | 'retrieve'
  | 'current'
  | 'target'
  | 'update'
  | 'recovery'
  | 'response'
  | 'rollback'

export type StripeAdminPlanChangeContext = {
  stripeSubscriptionId: string
  previousPriceId: string
  targetPriceId: string
}

export class StripeAdminPlanChangeError extends Error {
  constructor(
    readonly code: StripeAdminPlanChangeErrorCode,
    readonly stage: StripeAdminPlanChangeStage,
    cause?: unknown,
    readonly context: StripeAdminPlanChangeContext | null = null,
  ) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = 'StripeAdminPlanChangeError'
  }
}

export type StripePlatformSubscriptionSnapshot = {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeProductId: string
  stripePriceId: string
  unitAmountCents: number
  currency: string
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
}

export type StripeAdminPlanChangeReceipt = {
  changed: boolean
  previousPriceId: string
  targetPriceId: string
  provider: StripePlatformSubscriptionSnapshot
  rollback: () => Promise<StripePlatformSubscriptionSnapshot>
}

export type MigrateStripePlatformSubscriptionPlanInput = {
  platformSubscriptionId: string
  stripeSubscriptionId: string
  currentPlan: AdminStripePlan
  targetPlan: AdminStripePlan
  idempotencyKey: string
}

function idOf(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id
}

function isAdminStripePlan(value: PlatformPlanName): value is AdminStripePlan {
  return value === 'AGENT_INDIVIDUAL' || value === 'AGENCY'
}

function planCatalog(plan: AdminStripePlan, stage: StripeAdminPlanChangeStage) {
  try {
    const catalog = getStripeCatalogEntry(plan)
    if (!catalog) {
      throw new Error('STRIPE_CATALOG_ENTRY_MISSING')
    }
    return catalog
  } catch (cause) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage,
      cause,
    )
  }
}

function assertPrice(
  price: Stripe.Price,
  catalog: StripePlatformCatalogEntry,
  stage: StripeAdminPlanChangeStage,
) {
  try {
    assertStripePriceMatchesPlan(price, catalog)
  } catch (cause) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage,
      cause,
    )
  }
}

function soleItem(
  subscription: Stripe.Subscription,
  stage: StripeAdminPlanChangeStage,
): Stripe.SubscriptionItem {
  const item = subscription.items.data[0]
  if (subscription.items.data.length !== 1 || !item) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage,
    )
  }
  return item
}

function validateMapping(
  subscription: Stripe.Subscription,
  input: Pick<MigrateStripePlatformSubscriptionPlanInput,
    'platformSubscriptionId' | 'stripeSubscriptionId'>,
  stage: StripeAdminPlanChangeStage,
) {
  if (subscription.id !== input.stripeSubscriptionId) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_CONFLICT',
      stage,
    )
  }

  const mappedId = subscription.metadata.keeprOnePlatformSubscriptionId
  if (!mappedId) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_UNMAPPED',
      stage,
    )
  }
  if (mappedId !== input.platformSubscriptionId) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_SUBSCRIPTION_CONFLICT',
      stage,
    )
  }
}

function assertSubscriptionEditable(
  subscription: Stripe.Subscription,
  stage: StripeAdminPlanChangeStage,
) {
  if (subscription.schedule) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_SCHEDULED',
      stage,
    )
  }
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage,
    )
  }
}

function snapshotFrom(
  subscription: Stripe.Subscription,
  catalog: StripePlatformCatalogEntry,
  stage: StripeAdminPlanChangeStage,
): StripePlatformSubscriptionSnapshot {
  const item = soleItem(subscription, stage)
  assertPrice(item.price, catalog, stage)

  if (
    !Number.isSafeInteger(item.current_period_start)
    || !Number.isSafeInteger(item.current_period_end)
    || item.current_period_end <= item.current_period_start
  ) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      stage,
    )
  }

  return {
    status: toPlatformSubscriptionStatus(subscription.status),
    stripeCustomerId: idOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    stripeProductId: catalog.productId,
    stripePriceId: item.price.id,
    unitAmountCents: catalog.unitAmountCents,
    currency: catalog.currency.toUpperCase(),
    currentPeriodStart: new Date(item.current_period_start * 1_000),
    currentPeriodEnd: new Date(item.current_period_end * 1_000),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1_000)
      : null,
  }
}

function rollbackIdempotencyKey(input: MigrateStripePlatformSubscriptionPlanInput): string {
  const digest = createHash('sha256')
    .update(input.idempotencyKey)
    .update('\0')
    .update(input.stripeSubscriptionId)
    .update('\0')
    .update(input.currentPlan)
    .digest('hex')
  return `keeprone-admin-plan-rollback-${digest}`
}

function updateParams(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  priceId: string,
): Stripe.SubscriptionUpdateParams {
  return {
    items: [{
      id: item.id,
      price: priceId,
      quantity: item.quantity ?? 1,
    }],
    proration_behavior: 'none',
    payment_behavior: 'error_if_incomplete',
    metadata: {
      ...subscription.metadata,
      keeprOnePlatformSubscriptionId:
        subscription.metadata.keeprOnePlatformSubscriptionId,
    },
    expand: ['items.data.price.product'],
  }
}

const STRIPE_UPDATE_RETRY_DELAYS_MS = [100, 300] as const

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function updateSubscriptionWithRetry(input: {
  stripe: Stripe
  stripeSubscriptionId: string
  params: Stripe.SubscriptionUpdateParams
  idempotencyKey: string
}): Promise<Stripe.Subscription> {
  const causes: unknown[] = []

  for (let attempt = 0; attempt <= STRIPE_UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await input.stripe.subscriptions.update(
        input.stripeSubscriptionId,
        input.params,
        { idempotencyKey: input.idempotencyKey },
      )
    } catch (cause) {
      causes.push(cause)
      const retryDelay = STRIPE_UPDATE_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined) break
      await waitForRetry(retryDelay)
    }
  }

  throw new AggregateError(causes, 'Stripe plan change update remained uncertain')
}

async function restorePreviousPlan(input: {
  stripe: Stripe
  change: MigrateStripePlatformSubscriptionPlanInput
  subscription: Stripe.Subscription
  item: Stripe.SubscriptionItem
  catalog: StripePlatformCatalogEntry
  validateCatalogPrice: boolean
  context: StripeAdminPlanChangeContext
}): Promise<StripePlatformSubscriptionSnapshot> {
  try {
    if (input.validateCatalogPrice) {
      const previousPrice = await input.stripe.prices.retrieve(input.catalog.priceId, {
        expand: ['product'],
      })
      assertPrice(previousPrice, input.catalog, 'rollback')
    }

    const restored = await input.stripe.subscriptions.update(
      input.change.stripeSubscriptionId,
      updateParams(input.subscription, input.item, input.catalog.priceId),
      { idempotencyKey: rollbackIdempotencyKey(input.change) },
    )
    validateMapping(restored, input.change, 'rollback')
    assertSubscriptionEditable(restored, 'rollback')
    return snapshotFrom(restored, input.catalog, 'rollback')
  } catch (cause) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
      'rollback',
      cause,
      input.context,
    )
  }
}

function attachKnownContext(
  cause: unknown,
  context: StripeAdminPlanChangeContext,
): StripeAdminPlanChangeError {
  if (cause instanceof StripeAdminPlanChangeError) {
    if (cause.context) return cause
    return new StripeAdminPlanChangeError(
      cause.code,
      cause.stage,
      cause,
      context,
    )
  }
  return new StripeAdminPlanChangeError(
    'STRIPE_ADMIN_PLAN_CHANGE_UPDATE_FAILED',
    'update',
    cause,
    context,
  )
}

/**
 * Moves an existing Keepr One Stripe subscription between the individual and
 * agency prices without creating prorations. The returned receipt lets the
 * caller compensate the provider change if its following local transaction
 * cannot be committed.
 */
export async function migrateStripePlatformSubscriptionPlan(
  input: MigrateStripePlatformSubscriptionPlanInput,
): Promise<StripeAdminPlanChangeReceipt> {
  if (
    !input.platformSubscriptionId.trim()
    || !input.stripeSubscriptionId.trim()
    || !input.idempotencyKey.trim()
    || !isAdminStripePlan(input.currentPlan)
    || !isAdminStripePlan(input.targetPlan)
    || input.currentPlan === input.targetPlan
  ) {
    throw new StripeAdminPlanChangeError(
      'STRIPE_ADMIN_PLAN_CHANGE_PLAN_INVALID',
      'input',
    )
  }

  const currentCatalog = planCatalog(input.currentPlan, 'current')
  const targetCatalog = planCatalog(input.targetPlan, 'target')
  const context: StripeAdminPlanChangeContext = {
    stripeSubscriptionId: input.stripeSubscriptionId,
    previousPriceId: currentCatalog.priceId,
    targetPriceId: targetCatalog.priceId,
  }

  try {
    let stripe: Stripe
    try {
      stripe = getStripeClient()
    } catch (cause) {
      throw new StripeAdminPlanChangeError(
        'STRIPE_ADMIN_PLAN_CHANGE_UPDATE_FAILED',
        'retrieve',
        cause,
      )
    }

    let currentSubscription: Stripe.Subscription
    try {
      currentSubscription = await stripe.subscriptions.retrieve(
        input.stripeSubscriptionId,
        { expand: ['items.data.price.product'] },
      )
    } catch (cause) {
      throw new StripeAdminPlanChangeError(
        'STRIPE_ADMIN_PLAN_CHANGE_UPDATE_FAILED',
        'retrieve',
        cause,
      )
    }

    validateMapping(currentSubscription, input, 'current')
    assertSubscriptionEditable(currentSubscription, 'current')

    const currentItem = soleItem(currentSubscription, 'current')
    if (currentItem.price.id === targetCatalog.priceId) {
      const provider = snapshotFrom(currentSubscription, targetCatalog, 'current')
      return {
        changed: false,
        previousPriceId: currentCatalog.priceId,
        targetPriceId: targetCatalog.priceId,
        provider,
        rollback: () => restorePreviousPlan({
          stripe,
          change: input,
          subscription: currentSubscription,
          item: currentItem,
          catalog: currentCatalog,
          // The previous catalogue price is not present in this provider
          // response, so verify it before using it for orphan recovery.
          validateCatalogPrice: true,
          context,
        }),
      }
    }
    assertPrice(currentItem.price, currentCatalog, 'current')

    let targetPrice: Stripe.Price
    try {
      targetPrice = await stripe.prices.retrieve(targetCatalog.priceId, {
        expand: ['product'],
      })
    } catch (cause) {
      throw new StripeAdminPlanChangeError(
        'STRIPE_ADMIN_PLAN_CHANGE_UPDATE_FAILED',
        'target',
        cause,
      )
    }
    assertPrice(targetPrice, targetCatalog, 'target')

    const rollback = () => restorePreviousPlan({
      stripe,
      change: input,
      subscription: currentSubscription,
      item: currentItem,
      catalog: currentCatalog,
      // This exact price was already validated on the current subscription.
      validateCatalogPrice: false,
      context,
    })

    let updated: Stripe.Subscription
    try {
      updated = await updateSubscriptionWithRetry({
        stripe,
        stripeSubscriptionId: input.stripeSubscriptionId,
        params: updateParams(currentSubscription, currentItem, targetCatalog.priceId),
        idempotencyKey: input.idempotencyKey,
      })
    } catch (updateCause) {
      let recovered: Stripe.Subscription
      try {
        recovered = await stripe.subscriptions.retrieve(
          input.stripeSubscriptionId,
          { expand: ['items.data.price.product'] },
        )
      } catch (recoveryCause) {
        throw new StripeAdminPlanChangeError(
          'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
          'recovery',
          new AggregateError(
            [updateCause, recoveryCause],
            'Stripe plan change state could not be recovered',
          ),
          context,
        )
      }

      let recoveredItem: Stripe.SubscriptionItem
      try {
        validateMapping(recovered, input, 'recovery')
        assertSubscriptionEditable(recovered, 'recovery')
        recoveredItem = soleItem(recovered, 'recovery')
      } catch (recoveryCause) {
        throw new StripeAdminPlanChangeError(
          'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
          'recovery',
          new AggregateError(
            [updateCause, recoveryCause],
            'Stripe plan change state failed recovery validation',
          ),
          context,
        )
      }

      if (recoveredItem.price.id === targetCatalog.priceId) {
        let recoveredProvider: StripePlatformSubscriptionSnapshot
        try {
          recoveredProvider = snapshotFrom(recovered, targetCatalog, 'recovery')
        } catch (recoveryCause) {
          throw new StripeAdminPlanChangeError(
            'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
            'recovery',
            new AggregateError(
              [updateCause, recoveryCause],
              'Stripe target state failed recovery validation',
            ),
            context,
          )
        }
        return {
          changed: true,
          previousPriceId: currentCatalog.priceId,
          targetPriceId: targetCatalog.priceId,
          provider: recoveredProvider,
          rollback,
        }
      }

      if (recoveredItem.price.id === currentCatalog.priceId) {
        try {
          snapshotFrom(recovered, currentCatalog, 'recovery')
        } catch (recoveryCause) {
          throw new StripeAdminPlanChangeError(
            'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
            'recovery',
            new AggregateError(
              [updateCause, recoveryCause],
              'Stripe previous state failed recovery validation',
            ),
            context,
          )
        }
        throw new StripeAdminPlanChangeError(
          'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
          'recovery',
          updateCause,
          context,
        )
      }

      throw new StripeAdminPlanChangeError(
        'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
        'recovery',
        updateCause,
        context,
      )
    }

    let provider: StripePlatformSubscriptionSnapshot
    try {
      validateMapping(updated, input, 'response')
      assertSubscriptionEditable(updated, 'response')
      provider = snapshotFrom(updated, targetCatalog, 'response')
    } catch (cause) {
      try {
        await rollback()
      } catch (rollbackCause) {
        throw new StripeAdminPlanChangeError(
          'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED',
          'rollback',
          new AggregateError([cause, rollbackCause], 'Stripe plan change rollback failed'),
        )
      }
      throw cause
    }

    return {
      changed: true,
      previousPriceId: currentCatalog.priceId,
      targetPriceId: targetCatalog.priceId,
      provider,
      rollback,
    }
  } catch (cause) {
    throw attachKnownContext(cause, context)
  }
}
