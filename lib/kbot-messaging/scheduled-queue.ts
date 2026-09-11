import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { availableCredits, fingerprint, normalizePhone, TOKEN_RESERVATION } from '@/lib/kbot-followup/domain'
import { ACTIVE_JOB_STATES, AWAITING_APPROVAL, SENT_JOB_STATES, COOLDOWN_MS } from '@/lib/kbot-followup/domain'
import { grantFreeCredits, lockAgent, settleGeneration, spendWithoutJob, type Tx } from '@/lib/kbot-followup/credits'
import { renderTemplate } from '@/lib/kbot-templates/variables'
import { templateValuesFor } from '@/lib/kbot-templates/approval-view'
import type { ScheduledCategory } from '@/lib/kbot-templates/categories'
import { evaluateSendGate, type SendGateBlockReason } from './send-gate'
import { generateScheduledMessage, type ScheduledVoiceResult } from './scheduled-generation'
import { PROPOSAL_CATEGORIES, scheduledCandidatesForDay, type ProposalCandidate } from './scheduled-triggers'
import { LAPSE_RECENCY_MS, lapseCandidatesForPass } from './lapse-triggers'

/// Why a candidate this pass raised did not become a job.
///
/// A skip is not an error and is not silent: the pass returns every one of
/// these, so "nobody got a birthday message today" — or "that lapse never
/// reached me" — always has an answer that is not "look through the logs".
export type ScheduledSkipReason =
  /// The agent has no enabled template for this category and language. There is
  /// no house default to fall back to, on purpose.
  | 'TEMPLATE_MISSING'
  /// A job already exists for this event: this year's birthday, this lapse. The
  /// normal outcome of a second pass.
  | 'ALREADY_QUEUED'
  /// The agent's credit grants cannot cover another reservation.
  | 'INSUFFICIENT_CREDITS'
  /// Two clients of this agent share the number, so a message naming one of
  /// them would reach the other. The manual screen refuses the same case.
  | 'CONTACT_AMBIGUOUS'
  /// There is no text to propose. Either the K-Bot writes this category and the
  /// model gave nothing that passed the check, or the agent's template asks for
  /// a variable this system cannot fill. Nothing is queued: a proposal with
  /// nothing to read is not a proposal, and inventing the text is exactly what
  /// the check just refused.
  | 'MESSAGE_UNAVAILABLE'
  | SendGateBlockReason

export type ScheduledSkip = {
  candidateId: string
  category: string
  reason: ScheduledSkipReason
  /// The zone the candidate was judged in, and the one its hour will be judged
  /// in at dispatch.
  timeZone: string
}

export type ScheduledPassReport = {
  agents: number
  queued: number
  skipped: ScheduledSkip[]
}

/// Who this pass needs to visit.
///
/// This was "whoever wrote a text", and that made writing one a toll: an agent
/// with no text was never visited, so never received a message, so had no
/// reason to write one. It is now "whoever has a category switched on" — the
/// query is the same, but `enabled` no longer implies a text exists, because
/// the K-Bot writes the first one. Every proposal category counts, not only the
/// dated ones: an agent whose only enabled template is lapse recovery would
/// otherwise never be visited.
async function agentsWithProposalTemplates(): Promise<string[]> {
  const templates = await prisma.kBotMessageTemplate.findMany({
    where: { enabled: true, category: { in: [...PROPOSAL_CATEGORIES] } },
    select: { agentId: true },
    distinct: ['agentId'],
  })
  return templates.map((template) => template.agentId)
}

/// Everything one agent's book asks of this pass, gated and queued: the dates
/// that fall today, and the policies that fell out of force lately.
export async function enqueueScheduledMessagesForAgent(
  agentId: string,
  now = new Date(),
): Promise<{ queued: number; skipped: ScheduledSkip[] }> {
  const skipped: ScheduledSkip[] = []
  let queued = 0

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { user: true } })
  if (!agent || agent.status !== 'ACTIVE' || agent.user.banned) return { queued, skipped }

  const language = agent.user.language
  const agentName = agent.user.name ?? ''
  // The allowance, read the way the preflight needs it: the free grant of the
  // month may not exist yet, and a read that did not create it first would
  // report an agent with credit as having none. `queueOne` grants it again,
  // inside the lock, and stays the authority on what may be reserved.
  let granted = false
  const allowance = async () => {
    if (!granted) {
      await prisma.$transaction(async (tx: Tx) => {
        await lockAgent(tx, agentId)
        await grantFreeCredits(tx, agentId, now)
      })
      granted = true
    }
    const grants = await prisma.kBotCreditGrant.findMany({ where: { agentId, expiresAt: { gt: now } } })
    return availableCredits(grants)
  }

  const templates = await prisma.kBotMessageTemplate.findMany({
    where: { agentId, enabled: true, category: { in: [...PROPOSAL_CATEGORIES] } },
    select: { category: true, language: true, autoSend: true, body: true },
  })
  // Two things, not one: whether the message waits for the agent, and which
  // text it carries — null meaning "the K-Bot writes this one".
  // Typed as a plain string key: `as const` on the entry would infer a
  // template-literal key type that the `string` lookups below cannot satisfy.
  const enabledFor = new Map<string, { autoSend: boolean; body: string | null }>(templates.map((template) =>
    [`${template.category}:${template.language}`, { autoSend: template.autoSend === true, body: template.body ?? null }]))

  const [clients, policies, lapsed] = await Promise.all([
    prisma.client.findMany({
      where: { assignedAgentId: agentId },
      select: { id: true, name: true, phone: true, dateOfBirth: true },
    }),
    prisma.policy.findMany({
      where: { agentId, status: 'INFORCE', client: { assignedAgentId: agentId } },
      select: { id: true, clientId: true, effectiveDate: true },
    }),
    // Its own read, deliberately: the query above is filtered to INFORCE
    // because that is what an annual review is about, and relaxing it to serve
    // lapse would start proposing reviews for policies that are no longer
    // there. The window is repeated here only to keep the read small — the
    // engine re-checks it and stays the authority on what counts as recent.
    prisma.policy.findMany({
      where: { agentId, status: 'LAPSED', client: { assignedAgentId: agentId },
        statusChangedAt: { gte: new Date(now.getTime() - LAPSE_RECENCY_MS), lte: now } },
      select: { id: true, clientId: true, status: true, sourceStatus: true, statusChangedAt: true },
    }),
  ])

  // The engine wants a number it can send to, so normalization happens here
  // rather than leaving the engine to know what a valid number looks like.
  const reachable = clients.map((client) => ({ ...client, phone: normalizePhone(client.phone) }))
  // A number that belongs to two people in the same book cannot be messaged
  // about either of them: a household sharing a line would get a lapse notice
  // naming the wrong person, on their own phone. The manual screen already
  // refuses this as CONTACT_AMBIGUOUS; the proposal path had no such check, and
  // nothing downstream would have caught it.
  const clientsByPhone = new Map<string, number>()
  for (const client of reachable) {
    if (client.phone) clientsByPhone.set(client.phone, (clientsByPhone.get(client.phone) ?? 0) + 1)
  }
  const shared = new Set([...clientsByPhone].filter(([, count]) => count > 1).map(([phone]) => phone))
  const candidates: ProposalCandidate[] = [
    ...scheduledCandidatesForDay({ clients: reachable, policies, now }),
    ...lapseCandidatesForPass({ clients: reachable, policies: lapsed, now }),
  ]

  for (const candidate of candidates) {
    const skip = (reason: ScheduledSkipReason) => {
      skipped.push({ candidateId: candidate.candidateId, category: candidate.category, reason, timeZone: candidate.timeZone })
    }
    if (candidate.phone && shared.has(candidate.phone)) {
      skip('CONTACT_AMBIGUOUS')
      continue
    }
    const key = `${candidate.category}:${language}`
    // Existence and the flag are asked separately: keying "is there a template"
    // off the flag's value would make a template whose flag is absent look like
    // no template at all.
    const entry = enabledFor.get(key)
    if (!entry) {
      skip('TEMPLATE_MISSING')
      continue
    }

    // The text is resolved here only for what will wait for the agent. The
    // approval screen promises they read the message that actually leaves, and
    // that is impossible if the text is born at dispatch, after they released
    // it. A category that sends on its own is written at dispatch, where it has
    // always been written: nobody reads it first, and writing it there is what
    // keeps the pass from paying for messages the dispatch gate then stops —
    // and from paying again every pass for a job quiet hours keeps putting back.
    let content: string | null = null
    let voice: ScheduledVoiceResult | null = null
    if (!entry.autoSend) {
      const resolved = await textForApproval({ agentId, candidate, language, agentName, entry, now, allowance })
      if (!resolved.ok) {
        skip(resolved.reason)
        continue
      }
      content = resolved.text
      voice = resolved.voice
    }

    const outcome = await queueOne(agentId, candidate, language, now, entry.autoSend, content, voice)
    if (outcome === 'QUEUED') queued += 1
    else skip(outcome)
  }

  return { queued, skipped }
}

async function queueOne(
  agentId: string,
  candidate: ProposalCandidate,
  language: string,
  now: Date,
  autoSend: boolean,
  content: string | null,
  voice: ScheduledVoiceResult | null,
): Promise<'QUEUED' | ScheduledSkipReason> {
  return prisma.$transaction(async (tx: Tx) => {
    // Same lock the manual path takes, so a pass and an agent pressing send
    // cannot both spend the last reservation.
    await lockAgent(tx, agentId)

    const refusal = await screenCandidate(tx, agentId, candidate, now)
    if (refusal) return refusal

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
      // The text a proposal waits with, and empty for what sends on its own —
      // that one is written at dispatch. The worker reads this column as the
      // final word: a job that carries text is sent with it, unchanged.
      content,
      // Only when the model wrote what is in `content`. A refused attempt is
      // still charged below, but the text is the agent's, and stamping the
      // model on it would credit the wrong author.
      ...(voice?.ok ? { model: voice.model } : {}),
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
    // The model was called before this transaction, so the reservation is spent
    // in it. The allocations have to exist first — this charges against them —
    // and a job created without this step would carry text nobody paid for.
    // `attempted` covers the refusal that fell back to the agent's template:
    // the request reached the provider either way, and the job it produced is
    // the right thing to charge it to.
    if (voice && (voice.attempted || voice.ok)) await settleGeneration(tx, job, voice.inputTokens, voice.outputTokens)
    return 'QUEUED'
  })
}

/// Everything that decides whether a candidate becomes a job, apart from the
/// allowance: the event already queued, what the contact has asked for, and the
/// window shared with every other category.
///
/// Takes the client to read with so the same implementation answers twice: once
/// under the agent lock inside `queueOne`, where it is the authority, and once
/// before the model is asked anything, where it is not.
async function screenCandidate(
  db: Tx,
  agentId: string,
  candidate: ProposalCandidate,
  now: Date,
): Promise<ScheduledSkipReason | null> {
  // The deterministic key is what makes a second pass over the same event a
  // no-op — today's date, or the lapse that has not changed since. The unique
  // index is the real guarantee; this read is what lets the report say "already
  // queued" instead of surfacing a constraint violation.
  const existing = await db.kBotFollowupJob.findFirst({
    where: { agentId, requestKey: candidate.requestKey, candidateId: candidate.candidateId },
    select: { id: true },
  })
  if (existing) return 'ALREADY_QUEUED'

  // Preferences can be filed under the subject or under the number itself —
  // a stop request arrives by phone, not by client id.
  const preferences = await db.kBotContactPreference.findMany({
    where: { agentId, subjectKey: { in: [candidate.subjectKey, candidate.phone] } },
  })
  // Every category counts against the window, which is why this filters on
  // the phone alone: a lapse warning sent on Tuesday silences the birthday
  // greeting on Thursday, and vice versa.
  const recent = await db.kBotFollowupJob.findFirst({
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
  return gate.reason ?? null
}

type ApprovalText =
  | { ok: true; text: string; voice: ScheduledVoiceResult | null }
  | { ok: false; reason: ScheduledSkipReason }

/// The text a proposal will wait with, resolved before the job exists.
async function textForApproval(input: {
  agentId: string
  candidate: ProposalCandidate
  language: string
  agentName: string
  entry: { autoSend: boolean; body: string | null }
  now: Date
  allowance: () => Promise<number>
}): Promise<ApprovalText> {
  const { agentId, candidate, language, entry, now } = input
  const values = templateValuesFor({ customerName: candidate.customerName, agentName: input.agentName })

  const floor = entry.body == null ? null : renderTemplate(entry.body, values)
  // The save path refuses unknown variables, so reaching here means the
  // template changed underneath. There is nothing to show and nothing to
  // invent; the candidate comes back on the next pass.
  if (floor && !floor.ok) return { ok: false, reason: 'MESSAGE_UNAVAILABLE' }
  const floorText = floor?.ok ? floor.text : null

  // A birthday is the one category where the same words every year is the
  // problem, so the model writes it even when the agent has a template — the
  // template is the floor it falls back to, which is exactly what the dispatch
  // path does. For the other two the agent's own words win, and the model
  // writes only what does not exist yet.
  if (candidate.category !== 'BIRTHDAY' && floorText !== null) {
    return { ok: true, text: floorText, voice: null }
  }

  // Not the authority — `queueOne` makes every one of these checks again, under
  // the agent lock, and it is the one that decides. This exists so the model is
  // not paid for a candidate the transaction is about to refuse: a second pass
  // over a birthday already queued, a contact who asked us to stop, an agent
  // with no allowance left. Deleting it would not change what gets queued, only
  // what it costs — every pass, for as long as the candidate lasts.
  const refusal = await screenCandidate(prisma, agentId, candidate, now)
  if (refusal) return { ok: false, reason: refusal }
  if (await input.allowance() < TOKEN_RESERVATION) return { ok: false, reason: 'INSUFFICIENT_CREDITS' }

  const written = await generateScheduledMessage({
    firstName: values.primeiro_nome,
    agentName: values.agente,
    language,
    category: candidate.category as ScheduledCategory,
  })
  if (written.ok) return { ok: true, text: written.text, voice: written }

  // Refused by the check, or no model to ask. The agent's template is the floor:
  // the job is still raised, in their own words, and carries the charge for the
  // attempt.
  if (floorText !== null) return { ok: true, text: floorText, voice: written }

  // No floor to land on. Nothing is queued — writing text here is exactly what
  // the check just refused — but the provider was asked, and an attempt nobody
  // is charged for is a retry that costs the agent nothing and us something,
  // every pass. With no job to hang it on, it goes straight against the
  // allowance; that also ends the loop, because the preflight above stops
  // asking once the allowance is gone.
  if (written.attempted) {
    await prisma.$transaction(async (tx: Tx) => {
      await lockAgent(tx, agentId)
      // The same ceiling `settleGeneration` applies: a provider anomaly cannot
      // spend more than one message was ever authorized to cost.
      await spendWithoutJob(tx, agentId, Math.min(TOKEN_RESERVATION, written.inputTokens + written.outputTokens), now)
    })
  }
  return { ok: false, reason: 'MESSAGE_UNAVAILABLE' }
}

/// One enqueue pass over every agent that has a template.
export async function runScheduledMessageEnqueuePass(now = new Date()): Promise<ScheduledPassReport> {
  const agentIds = await agentsWithProposalTemplates()
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
export async function runScheduledMessagePass(now = new Date(), maxSends = 50): Promise<ScheduledPassReport & { sent: number; settled: number; expired: number; deferred: number; illustrationsExpired: number }> {
  const { releaseExpiredScheduledLeases, processNextScheduledMessage } = await import('./scheduled-worker')
  await releaseExpiredScheduledLeases(now)
  // Before enqueuing more: proposals nobody released go back, reservation and
  // all. Otherwise an agent who never opens the screen loses their allowance to
  // messages that were never sent.
  const { expireStaleScheduledProposals } = await import('./approval')
  const expired = await expireStaleScheduledProposals(now)
  // The illustration requests ride the same pass rather than earning a cron of
  // their own: both are "something the agent never got to", both hold a slot,
  // and a second scheduled entry point is a second thing to forget to set up.
  const { expireStaleIllustrationRequests } = await import('@/lib/kbot-illustration/delivery')
  const illustrations = await expireStaleIllustrationRequests(now)
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
  return { ...report, sent, settled, expired, deferred: deferred.length, illustrationsExpired: illustrations.expired }
}
