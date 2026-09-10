import 'server-only'

import { prisma } from '@/lib/prisma'
import { lockAgent, settleJob } from '@/lib/kbot-followup/credits'
import { APPROVAL_WINDOW_MS, AWAITING_APPROVAL } from '@/lib/kbot-followup/domain'
import { SCHEDULED_CATEGORIES } from './scheduled-triggers'

/// Releasing scheduled messages the agent has read.
///
/// A trigger prepares the text; a person decides it goes. Approval moves the
/// job from AWAITING_APPROVAL to PENDING, which is the only state the worker
/// claims — so nothing here sends anything itself. Every rule still applies at
/// dispatch: opt-out, the shared weekly window, and the recipient's own hours.

export type ApprovalResult = { released: number }

/// Release the proposals the agent selected.
///
/// Scoped to the agent and to jobs still awaiting approval, so a stale screen
/// cannot resurrect a job that was already sent, cancelled or expired — the
/// `updateMany` predicate simply matches nothing.
export async function approveScheduledMessages(
  agentId: string,
  jobIds: readonly string[],
  now = new Date(),
): Promise<ApprovalResult> {
  if (jobIds.length === 0) return { released: 0 }
  const released = await prisma.$transaction(async (tx) => {
    await lockAgent(tx, agentId)
    const result = await tx.kBotFollowupJob.updateMany({
      where: {
        id: { in: [...jobIds] },
        agentId,
        category: { in: [...SCHEDULED_CATEGORIES] },
        status: AWAITING_APPROVAL,
        // The window is re-checked here, not only by the sweep. A tab left open
        // overnight would otherwise release a greeting that expired hours ago,
        // in the gap before the sweep next runs.
        createdAt: { gte: new Date(now.getTime() - APPROVAL_WINDOW_MS) },
      },
      data: { status: 'PENDING' },
    })
    return result.count
  })
  return { released }
}

/// Discard the proposals the agent chose not to send.
export async function discardScheduledMessages(
  agentId: string,
  jobIds: readonly string[],
): Promise<ApprovalResult> {
  if (jobIds.length === 0) return { released: 0 }
  const released = await prisma.$transaction(async (tx) => {
    await lockAgent(tx, agentId)
    const jobs = await tx.kBotFollowupJob.findMany({
      where: {
        id: { in: [...jobIds] },
        agentId,
        category: { in: [...SCHEDULED_CATEGORIES] },
        status: AWAITING_APPROVAL,
      },
    })
    // `settleJob` hands the reservation back, which a plain status update would
    // not: the tokens were reserved when the proposal was raised.
    for (const job of jobs) await settleJob(tx, job, 'CANCELLED', 'DISCARDED_BY_AGENT')
    return jobs.length
  })
  return { released }
}

/// Drop proposals nobody released in time.
///
/// Two things go wrong without this. A greeting approved a week late is worse
/// than none, and — quieter but worse — the credit reserved when the proposal
/// was raised would never come back, so an agent who ignores the screen would
/// slowly lose their monthly allowance to messages that never went out.
export async function expireStaleScheduledProposals(now = new Date()): Promise<number> {
  const stale = await prisma.kBotFollowupJob.findMany({
    where: {
      status: AWAITING_APPROVAL,
      category: { in: [...SCHEDULED_CATEGORIES] },
      createdAt: { lt: new Date(now.getTime() - APPROVAL_WINDOW_MS) },
    },
    take: 100,
  })
  for (const job of stale) {
    await prisma.$transaction(async (tx) => {
      await lockAgent(tx, job.agentId)
      const current = await tx.kBotFollowupJob.findUnique({ where: { id: job.id } })
      // It may have been approved between the read and this transaction.
      if (current?.status !== AWAITING_APPROVAL) return
      await settleJob(tx, current, 'CANCELLED', 'APPROVAL_EXPIRED')
    })
  }
  return stale.length
}
