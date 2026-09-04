import 'server-only'
import { Prisma, type KBotFollowupJob } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { availableCredits, positiveInteger } from './domain'

export type Tx = Prisma.TransactionClient
export async function lockAgent(tx: Tx, agentId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kbot-followup:${agentId}`}))`
}
export async function grantFreeCredits(tx: Tx, agentId: string, now = new Date()) {
  const period = now.toISOString().slice(0, 7)
  return tx.kBotCreditGrant.upsert({ where: { sourceKey: `free:${agentId}:${period}` }, update: {}, create: {
    agentId, sourceKey: `free:${agentId}:${period}`, allowance: positiveInteger(process.env.KBOT_FOLLOWUP_FREE_TOKENS, 1000, 1_000_000),
    expiresAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  } })
}
export async function creditBalance(agentId: string) {
  return prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    await grantFreeCredits(tx, agentId)
    const grants = await tx.kBotCreditGrant.findMany({ where: { agentId, expiresAt: { gt: new Date() } } })
    return { available: availableCredits(grants), reserved: grants.reduce((n, g) => n + g.reserved, 0),
      spent: grants.reduce((n, g) => n + g.spent, 0) }
  })
}

/** Job and grant update are in one transaction. Calling this twice cannot charge twice. */
export async function settleJob(tx: Tx, job: KBotFollowupJob, status: string, errorCode?: string, providerMessageId?: string) {
  const creditState = job.creditState === 'RESERVED' ? 'RELEASED' : job.creditState
  if (job.creditState === 'RESERVED' && job.grantId) {
    const allocations = await tx.kBotCreditAllocation.findMany({ where: { jobId: job.id } })
    for (const allocation of allocations) await tx.kBotCreditGrant.update({ where: { id: allocation.grantId }, data: {
      reserved: { decrement: allocation.reservedTokens },
    } })
  }
  return tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status, creditState, leaseExpiresAt: null,
    notifiedAt: null, errorCode: errorCode ?? null, ...(providerMessageId ? { providerMessageId } : {}) } })
}

export async function settleGeneration(tx: Tx, job: KBotFollowupJob, inputTokens: number, outputTokens: number) {
  if (job.creditState !== 'RESERVED' || !job.grantId) return
  // A provider anomaly cannot spend above the ceiling accepted by the user.
  let remaining = Math.min(job.reservedTokens, inputTokens + outputTokens)
  const allocations = await tx.kBotCreditAllocation.findMany({ where: { jobId: job.id }, orderBy: { grant: { expiresAt: 'asc' } } })
  for (const allocation of allocations) {
    const spent = Math.min(remaining, allocation.reservedTokens)
    remaining -= spent
    await tx.kBotCreditGrant.update({ where: { id: allocation.grantId }, data: { reserved: { decrement: allocation.reservedTokens }, spent: { increment: spent } } })
    await tx.kBotCreditAllocation.update({ where: { id: allocation.id }, data: { spentTokens: spent } })
  }
  await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { creditState: 'SPENT', inputTokens, outputTokens, billedTokens: Math.min(job.reservedTokens, inputTokens + outputTokens) } })
}
