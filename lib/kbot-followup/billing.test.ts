import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoice: vi.fn(), subscription: vi.fn(), grant: vi.fn(), local: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ getStripeClient: () => ({ invoices: { retrieve: mocks.invoice }, subscriptions: { retrieve: mocks.subscription } }) }))
vi.mock('@/lib/prisma', () => {
  const tx = { $executeRaw: vi.fn(), platformAddonSubscription: { findUniqueOrThrow: mocks.local, update: mocks.update }, kBotCreditGrant: { upsert: mocks.grant } }
  return { prisma: { platformAddonSubscription: { findUnique: mocks.local, findUniqueOrThrow: mocks.local }, $transaction: async (f: (x: typeof tx) => unknown) => f(tx) } }
})
import { grantPaidFollowupInvoice, syncFollowupSubscription } from './billing'
const price = { id: 'price_test', product: 'prod_test', active: true, currency: 'usd', unit_amount: 900, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }
const subscription = { id: 'sub_test', status: 'active', customer: 'cus_test', metadata: { keeprOneAddon: 'K_BOT_FOLLOWUP', keeprOnePlatformAddonSubscriptionId: 'local', keeprOneAgentId: 'agent', keeprOneFollowupTokens: '100000' },
  items: { data: [{ quantity: 1, price, current_period_start: 1788470000, current_period_end: 1791062000 }] }, cancel_at_period_end: false, canceled_at: null }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STRIPE_KBOT_FOLLOWUP_PRICE_ID', 'price_test'); vi.stubEnv('STRIPE_KBOT_FOLLOWUP_PRODUCT_ID', 'prod_test')
  mocks.subscription.mockResolvedValue(subscription)
  mocks.local.mockResolvedValue({ id: 'local', agentId: 'agent', addon: 'K_BOT_FOLLOWUP', stripeSubscriptionId: 'sub_test' })
  mocks.invoice.mockResolvedValue({ id: 'in_test', status: 'paid', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_test' } },
    lines: { has_more: false, data: [{ quantity: 1, pricing: { price_details: { price: 'price_test' } }, period: { end: 1791062000 } }] } })
})
describe('paid token grants', () => {
  it('never grants from subscription activation or an unpaid invoice', async () => {
    await syncFollowupSubscription('sub_test'); expect(mocks.grant).not.toHaveBeenCalled()
    mocks.invoice.mockResolvedValue({ status: 'open' })
    await grantPaidFollowupInvoice('in_test'); expect(mocks.grant).not.toHaveBeenCalled()
  })
  it('keys a paid grant to the exact invoice and never increments on replay', async () => {
    await grantPaidFollowupInvoice('in_test'); await grantPaidFollowupInvoice('in_test')
    expect(mocks.grant).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceKey: 'invoice:in_test' }, update: {}, create: expect.objectContaining({ agentId: 'agent', allowance: 100000 }) }))
  })
  it('rejects metadata belonging to another agent', async () => {
    mocks.local.mockResolvedValue({ id: 'local', agentId: 'other', addon: 'K_BOT_FOLLOWUP', stripeSubscriptionId: 'sub_test' })
    await expect(grantPaidFollowupInvoice('in_test')).rejects.toThrow('ADDON_CONFLICT')
    expect(mocks.grant).not.toHaveBeenCalled()
  })
  it('never refills credits for a proration', async () => {
    const invoice = await mocks.invoice()
    mocks.invoice.mockResolvedValue({ ...invoice, billing_reason: 'subscription_update' })
    await grantPaidFollowupInvoice('in_test'); expect(mocks.grant).not.toHaveBeenCalled()
  })
})
