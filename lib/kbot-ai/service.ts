import 'server-only'
import { prisma } from '@/lib/prisma'
import { grantFreeCredits, lockAgent } from '@/lib/kbot-followup/credits'
import { aiEnabled, availableCredits, TOKEN_RESERVATION } from '@/lib/kbot-followup/domain'
import { AI_PAGE_SIZE, WORKING_STATUSES, filterStatuses, periodStart, summarizeStatuses, type AiFilter, type AiOverview, type AiPeriod } from './overview'

/** Uses the existing monthly grant contract; never calls AI, messaging or Stripe. */
export async function getAiOverview(agentId: string, options: { period: AiPeriod; filter: AiFilter; page: number }, now = new Date()): Promise<AiOverview> {
  const start = periodStart(options.period, now)
  const dates = { gte: start, lte: now }
  const cohort = { agentId, createdAt: dates }
  const statuses = filterStatuses(options.filter)
  const activityWhere = { ...cohort, ...(statuses ? { status: { in: statuses } } : {}) }
  return prisma.$transaction(async tx => {
    // Same account lock as authorization/settlement: a wallet snapshot cannot mix a reservation and its spend.
    await lockAgent(tx, agentId)
    await grantFreeCredits(tx, agentId, now)
    const [grants, consumption, impactRows, currentRows, total, channel, subscription] = await Promise.all([
      tx.kBotCreditGrant.findMany({ where: { agentId, expiresAt: { gt: now } }, select: { allowance: true, spent: true, reserved: true, expiresAt: true }, orderBy: { expiresAt: 'asc' } }),
      // Use generation time, not mutable updatedAt or the current wallet (expired grants still count).
      tx.kBotFollowupJob.aggregate({ where: { agentId, creditState: 'SPENT', OR: [
        { generationStartedAt: dates }, { generationStartedAt: null, createdAt: dates },
      ] }, _sum: { billedTokens: true }, _count: { _all: true } }),
      tx.kBotFollowupJob.groupBy({ by: ['status'], where: cohort, _count: { _all: true } }),
      tx.kBotFollowupJob.groupBy({ by: ['status'], where: { agentId, status: { in: [...WORKING_STATUSES, 'UNKNOWN'] } }, _count: { _all: true } }),
      tx.kBotFollowupJob.count({ where: activityWhere }),
      tx.agentMessagingChannel.findUnique({ where: { agentId_kind: { agentId, kind: 'WHATSAPP' } }, select: { status: true, provider: true } }),
      tx.platformAddonSubscription.findFirst({ where: { agentId, addon: 'K_BOT_FOLLOWUP', stripeSubscriptionId: { not: null }, status: { in: ['ACTIVE', 'PAST_DUE', 'TRIALING'] } },
        orderBy: { createdAt: 'desc' }, select: { unitAmountCents: true, currency: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } }),
    ])
    const page = Math.min(options.page, Math.max(0, Math.ceil(total / AI_PAGE_SIZE) - 1))
    const jobs = await tx.kBotFollowupJob.findMany({ where: activityWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: AI_PAGE_SIZE, skip: page * AI_PAGE_SIZE,
      select: { id: true, batchId: true, customerName: true, status: true, reason: true, creditState: true, billedTokens: true, reservedTokens: true,
        inputTokens: true, outputTokens: true, content: true, conversationId: true, createdAt: true } })
    const current = summarizeStatuses(currentRows)
    return {
      enabled: true, updatedAt: now.toISOString(), period: options.period, start: start.toISOString(),
      availability: !aiEnabled() ? 'AI_DISABLED' : channel?.status === 'CONNECTED' && channel.provider === 'EVOLUTION' ? 'READY' : 'CHANNEL_UNAVAILABLE',
      balance: {
        available: availableCredits(grants), reserved: grants.reduce((n, g) => n + g.reserved, 0), spent: grants.reduce((n, g) => n + g.spent, 0),
        allowance: grants.reduce((n, g) => n + g.allowance, 0),
        expiresAt: grants.find(g => g.allowance > g.spent + g.reserved)?.expiresAt.toISOString() ?? null,
      },
      consumption: { tokens: consumption._sum.billedTokens ?? 0, generations: consumption._count._all },
      impact: summarizeStatuses(impactRows), current: { working: current.working, unconfirmed: current.attention },
      reservationPerMessage: TOKEN_RESERVATION,
      subscription: subscription ? { cents: subscription.unitAmountCents, currency: subscription.currency, status: subscription.status,
        periodEnd: subscription.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd } : null,
      activity: { jobs: jobs.map(job => ({ ...job, createdAt: job.createdAt.toISOString() })), total, page, pageSize: AI_PAGE_SIZE, filter: options.filter },
    }
  })
}
