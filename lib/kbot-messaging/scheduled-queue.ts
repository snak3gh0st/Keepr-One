import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { availableCredits, fingerprint, normalizePhone, TOKEN_RESERVATION } from '@/lib/kbot-followup/domain'
import { ACTIVE_JOB_STATES, AWAITING_APPROVAL, SENT_JOB_STATES, COOLDOWN_MS } from '@/lib/kbot-followup/domain'
import { grantFreeCredits, lockAgent, type Tx } from '@/lib/kbot-followup/credits'
import { evaluateSendGate, type SendGateBlockReason } from './send-gate'
import { SCHEDULED_CATEGORIES, scheduledCandidatesForDay, type ScheduledCandidate } from './scheduled-triggers'

/// Why a candidate whose date was today did not become a job.
///
/// A skip is not an error and is not silent: the pass returns every one of
/// these, so "nobody got a birthday message today" always has an answer that
/// is not "look through the logs".
export type ScheduledSkipReason =
  /// The agent has no enabled template for this category and language. There is
  /// no house default to fall back to, on purpose.
  | 'TEMPLATE_MISSING'
  /// This year's job already exists. The normal outcome of a second pass.
  | 'ALREADY_QUEUED'
  /// The agent's credit grants cannot cover another reservation.
  | 'INSUFFICIENT_CREDITS'
  | SendGateBlockReason

export type ScheduledSkip = {
  candidateId: string
  category: string
  reason: ScheduledSkipReason
  /// The zone the date and the hour were both judged in.
  timeZone: string
}

export type ScheduledPassReport = {
  agents: number
  queued: number
  skipped: ScheduledSkip[]
}

/// Agents that have at least one enabled scheduled template.
///
/// The template is what makes the feature exist for an agent, so it is also the
/// cheapest way to avoid walking the book of everyone who never set one up.
async function agentsWithScheduledTemplates(): Promise<string[]> {
  const templates = await prisma.kBotMessageTemplate.findMany({
    where: { enabled: true, category: { in: [...SCHEDULED_CATEGORIES] } },
    select: { agentId: true },
    distinct: ['agentId'],
  })
  return templates.map((template) => template.agentId)
}

/// Everything today asks of one agent's book, gated and queued.
export async function enqueueScheduledMessagesForAgent(
  agentId: string,
  now = new Date(),
): Promise<{ queued: number; skipped: ScheduledSkip[] }> {
  const skipped: ScheduledSkip[] = []
  let queued = 0

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { user: true } })
  if (!agent || agent.status !== 'ACTIVE' || agent.user.banned) return { queued, skipped }

  const language = agent.user.language
  const templates = await prisma.kBotMessageTemplate.findMany({
    where: { agentId, enabled: true, category: { in: [...SCHEDULED_CATEGORIES] } },
    select: { category: true, language: true, autoSend: true },
  })
  // Keyed the same way the lookup below asks for it, carrying the one bit that
  // decides whether the message waits for the agent or not.
  // Typed as a plain string key: `as const` on the entry would infer a
  // template-literal key type that the `string` lookups below cannot satisfy.
  const enabledFor = new Map<string, boolean>(templates.map((template) =>
    [`${template.category}:${template.language}`, template.autoSend === true]))

  const [clients, policies] = await Promise.all([
    prisma.client.findMany({
      where: { assignedAgentId: agentId },
      select: { id: true, name: true, phone: true, dateOfBirth: true },
    }),
    prisma.policy.findMany({
      where: { agentId, status: 'INFORCE', client: { assignedAgentId: agentId } },
      select: { id: true, clientId: true, effectiveDate: true },
    }),
  ])

  const candidates = scheduledCandidatesForDay({
    // The engine wants a number it can send to, so normalization happens here
    // rather than leaving the engine to know what a valid number looks like.
    clients: clients.map((client) => ({ ...client, phone: normalizePhone(client.phone) })),
    policies,
    now,
  })

  for (const candidate of candidates) {
    const skip = (reason: ScheduledSkipReason) => {
      skipped.push({ candidateId: candidate.candidateId, category: candidate.category, reason, timeZone: candidate.timeZone })
    }
    const key = `${candidate.category}:${language}`
    // Existence and the flag are asked separately: keying "is there a template"
    // off the flag's value would make a template whose flag is absent look like
    // no template at all.
    if (!enabledFor.has(key)) {
      skip('TEMPLATE_MISSING')
      continue
    }
    const outcome = await queueOne(agentId, candidate, language, now, enabledFor.get(key) ?? false)
    if (outcome === 'QUEUED') queued += 1
    else skip(outcome)
  }

  return { queued, skipped }
}

async function queueOne(
  agentId: string,
  candidate: ScheduledCandidate,
  language: string,
  now: Date,
  autoSend: boolean,
): Promise<'QUEUED' | ScheduledSkipReason> {
  return prisma.$transaction(async (tx: Tx) => {
    // Same lock the manual path takes, so a pass and an agent pressing send
    // cannot both spend the last reservation.
    await lockAgent(tx, agentId)

    // The deterministic key is what makes a second pass today a no-op. The
    // unique index is the real guarantee; this read is what lets the report say
    // "already queued" instead of surfacing a constraint violation.
    const existing = await tx.kBotFollowupJob.findFirst({
      where: { agentId, requestKey: candidate.requestKey, candidateId: candidate.candidateId },
      select: { id: true },
    })
    if (existing) return 'ALREADY_QUEUED'

    // Preferences can be filed under the subject or under the number itself —
    // a stop request arrives by phone, not by client id.
    const preferences = await tx.kBotContactPreference.findMany({
      where: { agentId, subjectKey: { in: [candidate.subjectKey, candidate.phone] } },
    })
    // Every category counts against the window, which is why this filters on
    // the phone alone: a lapse warning sent on Tuesday silences the birthday
    // greeting on Thursday, and vice versa.
    const recent = await tx.kBotFollowupJob.findFirst({
      where: { agentId, phone: candidate.phone, OR: [
        { status: { in: ACTIVE_JOB_STATES } },
        { status: { in: SENT_JOB_STATES }, updatedAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
      ] },
      select: { id: true },
    })

    const gate = evaluateSendGate({
      phone: candidate.phone,
      preferences,
      recentJobs: recent ? [{ sentAt: now }] : [],
      now,
      // Not here. A birthday candidate exists only on its own local date: if
      // this pass happens to run during the recipient's quiet hours, refusing
      // now would drop the greeting for good, because tomorrow the candidate is
      // gone. Enqueuing is an intention, not a send — the hour is enforced at
      // dispatch, where a refusal returns the job to PENDING for the next pass.
      enforceQuietHours: false,
    })
    if (gate.reason) return gate.reason

    await grantFreeCredits(tx, agentId, now)
    const grants = await tx.kBotCreditGrant.findMany({ where: { agentId, expiresAt: { gt: now } }, orderBy: { expiresAt: 'asc' } })
    if (availableCredits(grants) < TOKEN_RESERVATION) return 'INSUFFICIENT_CREDITS'

    const grant = grants.find((g) => g.allowance > g.spent + g.reserved)!
    const job = await tx.kBotFollowupJob.create({ data: {
      agentId,
      category: candidate.category,
      // A scheduled message is its own batch: it was not authorized alongside
      // anything else, and the batch notification should not pretend it was.
      batchId: randomUUID(),
      requestKey: candidate.requestKey,
      candidateId: candidate.candidateId,
      fingerprint: fingerprint({ requestKey: candidate.requestKey, candidateId: candidate.candidateId, phone: candidate.phone }),
      customerName: candidate.customerName,
      phone: candidate.phone,
      subjectKey: candidate.subjectKey,
      language,
      reason: candidate.category,
      sourceHref: candidate.sourceHref,
      grantId: grant.id,
      reservedTokens: TOKEN_RESERVATION,
      // Nothing leaves without the agent releasing it. `autoSend` is the one
      // way past this, and only the agent turns that on, per category.
      status: autoSend ? 'PENDING' : AWAITING_APPROVAL,
    } })

    let remaining = TOKEN_RESERVATION
    for (const g of grants) {
      const amount = Math.min(remaining, g.allowance - g.spent - g.reserved)
      if (!amount) continue
      await tx.kBotCreditGrant.update({ where: { id: g.id }, data: { reserved: { increment: amount } } })
      await tx.kBotCreditAllocation.create({ data: { jobId: job.id, grantId: g.id, reservedTokens: amount } })
      g.reserved += amount
      remaining -= amount
      if (!remaining) break
    }
    return 'QUEUED'
  })
}

/// One enqueue pass over every agent that has a template.
export async function runScheduledMessageEnqueuePass(now = new Date()): Promise<ScheduledPassReport> {
  const agentIds = await agentsWithScheduledTemplates()
  const report: ScheduledPassReport = { agents: agentIds.length, queued: 0, skipped: [] }
  for (const agentId of agentIds) {
    // One agent's bad data must not stop the rest of the book being greeted.
    const result = await enqueueScheduledMessagesForAgent(agentId, now)
    report.queued += result.queued
    report.skipped.push(...result.skipped)
  }
  return report
}

/// The whole pass: release dead leases, enqueue today's dates, drain the queue.
///
/// The drain is bounded so one call cannot run for an unbounded time; whatever
/// is left is taken by the next pass.
export async function runScheduledMessagePass(now = new Date(), maxSends = 50): Promise<ScheduledPassReport & { sent: number; settled: number; expired: number; deferred: number }> {
  const { releaseExpiredScheduledLeases, processNextScheduledMessage } = await import('./scheduled-worker')
  await releaseExpiredScheduledLeases(now)
  // Before enqueuing more: proposals nobody released go back, reservation and
  // all. Otherwise an agent who never opens the screen loses their allowance to
  // messages that were never sent.
  const { expireStaleScheduledProposals } = await import('./approval')
  const expired = await expireStaleScheduledProposals(now)
  const report = await runScheduledMessageEnqueuePass(now)
  // A job put back for quiet hours is still the oldest PENDING row, so the
  // drain has to step over it. Without this, one recipient in the wrong time
  // zone would take every turn of the loop and nobody behind them would be
  // reached — this pass or any other.
  const deferred: string[] = []
  let sent = 0
  let settled = 0
  // Two bounds, because they answer different questions. `maxSends` caps how
  // many messages one pass may put on the wire; `maxTurns` caps how long the
  // loop may run at all, so a queue full of jobs that only ever settle — a
  // template switched off, a contact who opted out — cannot spin here, and
  // cannot eat the send budget either.
  const maxTurns = maxSends * 4
  for (let turns = 0; turns < maxTurns && sent < maxSends; turns += 1) {
    const turn = await processNextScheduledMessage(deferred)
    if (turn.outcome === 'IDLE') break
    if (turn.outcome === 'DEFERRED') { deferred.push(turn.id); continue }
    if (turn.outcome === 'SENT') sent += 1
    else settled += 1
  }
  return { ...report, sent, settled, expired, deferred: deferred.length }
}
