import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), grants: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn(), count: vi.fn(), jobs: vi.fn(), channel: vi.fn(), subscription: vi.fn(), lock: vi.fn(), free: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))
vi.mock('@/lib/kbot-followup/credits', () => ({ lockAgent: mocks.lock, grantFreeCredits: mocks.free }))
vi.mock('@/lib/kbot-followup/domain', async original => ({ ...await original<typeof import('@/lib/kbot-followup/domain')>(), aiEnabled: () => true }))
import { getAiOverview } from './service'
const tx = { kBotCreditGrant: { findMany: mocks.grants }, kBotFollowupJob: { aggregate: mocks.aggregate, groupBy: mocks.groupBy, count: mocks.count, findMany: mocks.jobs }, agentMessagingChannel: { findUnique: mocks.channel }, platformAddonSubscription: { findFirst: mocks.subscription } }
const now = new Date('2026-09-05T13:00:00Z')
beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation(fn => fn(tx))
  mocks.grants.mockResolvedValue([{ allowance: 1000, spent: 200, reserved: 192, expiresAt: new Date('2026-10-01') }])
  mocks.aggregate.mockResolvedValue({ _sum: { billedTokens: 1250 }, _count: { _all: 11 } })
  mocks.groupBy.mockResolvedValue([{ status: 'UNKNOWN', _count: { _all: 2 } }, { status: 'READ', _count: { _all: 5 } }])
  mocks.count.mockResolvedValue(125)
  mocks.jobs.mockResolvedValue([])
  mocks.channel.mockResolvedValue({ status: 'CONNECTED', provider: 'EVOLUTION' })
  mocks.subscription.mockResolvedValue(null)
})
describe('AI account overview', () => {
  it('uses all matching generations, keeps expired-grant usage, and never treats a wallet balance as period usage', async () => {
    const result = await getAiOverview('owner', { period: 'month', filter: 'all', page: 0 }, now)
    expect(result.consumption).toEqual({ tokens: 1250, generations: 11 })
    expect(result.balance).toMatchObject({ available: 608, reserved: 192, spent: 200 })
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { agentId: 'owner', creditState: 'SPENT', OR: [
      { generationStartedAt: { gte: new Date('2026-09-01'), lte: now } }, { generationStartedAt: null, createdAt: { gte: new Date('2026-09-01'), lte: now } },
    ] }, _sum: { billedTokens: true }, _count: { _all: true } })
    expect(mocks.grants).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId: 'owner', expiresAt: { gt: now } } }))
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'owner')
    expect(mocks.free).toHaveBeenCalledWith(tx, 'owner', now)
    expect(result.subscription).toBeNull()
  })
  it('scopes every query to the session account and paginates history without truncating totals', async () => {
    const result = await getAiOverview('owner', { period: '7d', filter: 'attention', page: 999 }, now)
    expect(result.activity).toMatchObject({ total: 125, page: 6, pageSize: 20, filter: 'attention' })
    for (const mock of [mocks.grants, mocks.aggregate, mocks.groupBy, mocks.count, mocks.jobs, mocks.subscription]) {
      for (const [query] of mock.mock.calls) expect(query.where.agentId).toBe('owner')
    }
    expect(mocks.channel.mock.calls[0][0].where.agentId_kind.agentId).toBe('owner')
    expect(mocks.jobs).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 120, where: expect.objectContaining({ status: { in: ['UNKNOWN', 'FAILED'] } }) }))
    // The live state is independent of the selected history period.
    expect(mocks.groupBy.mock.calls[1][0].where).not.toHaveProperty('createdAt')
  })
  it('does not infer paid charges from subscription price and identifies an unavailable channel', async () => {
    mocks.channel.mockResolvedValue({ status: 'DISCONNECTED', provider: 'EVOLUTION' })
    mocks.subscription.mockResolvedValue({ unitAmountCents: 900, currency: 'USD', status: 'PAST_DUE', currentPeriodEnd: new Date('2026-10-01'), cancelAtPeriodEnd: true })
    const result = await getAiOverview('owner', { period: 'month', filter: 'all', page: 0 }, now)
    expect(result.availability).toBe('CHANNEL_UNAVAILABLE')
    expect(result.subscription).toEqual({ cents: 900, currency: 'USD', status: 'PAST_DUE', periodEnd: '2026-10-01T00:00:00.000Z', cancelAtPeriodEnd: true })
    expect(result).not.toHaveProperty('amountPaid')
  })
})
