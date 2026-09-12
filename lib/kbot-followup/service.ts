import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { evaluateSendGate, type SendGateBlockReason } from '@/lib/kbot-messaging/send-gate'
import { ACTIVE_JOB_STATES, SENT_JOB_STATES, aiEnabled, availableCredits, COOLDOWN_MS, FollowupError, TOKEN_RESERVATION, normalizePhone } from './domain'

/// The gate names the reason; this path names it the way the agent's screen has
/// always named it. Opt-out and snooze collapse into one code on purpose: to
/// whoever just pressed send, both mean "you cannot reach this person now", and
/// the difference is the agent's own doing either way. QUIET_HOURS cannot occur
/// here — a human is choosing the moment — but the map stays total so a new
/// gate reason is a type error rather than an `undefined` error code.
const MANUAL_GATE_ERRORS: Record<SendGateBlockReason, string> = {
  OPTED_OUT: 'CONTACT_UNAVAILABLE',
  SNOOZED: 'CONTACT_UNAVAILABLE',
  RECENT_CONTACT: 'RECENT_CONTACT',
  QUIET_HOURS: 'RECENT_CONTACT',
  // Inalcançável aqui: este caminho chama o gate com `requireEnabled: false`.
  // O mapa continua total só para que um novo motivo do gate seja erro de tipo.
  NOT_ENABLED: 'CONTACT_UNAVAILABLE',
}
import { getFollowupCandidates } from './candidates'
import { grantFreeCredits, lockAgent, settleJob } from './credits'
import { messagingTransport } from './transport'

export async function startFollowups(agentId: string, input: { requestKey: string; language: 'PT' | 'EN'; candidates: Array<{ id: string; fingerprint: string }> }) {
  if (!aiEnabled()) throw new FollowupError('AI_UNAVAILABLE', 503)
  const previous = await prisma.kBotFollowupJob.findMany({ where: { agentId, requestKey: input.requestKey } })
  if (previous.length) {
    if (previous.length !== input.candidates.length || previous.some(j => !input.candidates.some(c => c.id === j.candidateId && c.fingerprint === j.fingerprint) || j.language !== input.language)) throw new FollowupError('REQUEST_CONFLICT')
    return { batchId: previous[0].batchId }
  }
  const current = await getFollowupCandidates(agentId)
  const candidates = input.candidates.map(c => {
    const row = current.find(r => r.id === c.id)
    if (!row || row.fingerprint !== c.fingerprint) throw new FollowupError('SOURCE_CHANGED')
    if (row.blockedReason) throw new FollowupError(row.blockedReason)
    return row
  })
  if (!candidates.length || candidates.length > 25 || new Set(candidates.map(c => c.phone)).size !== candidates.length) throw new FollowupError('INVALID_SELECTION', 400)
  const transport = await messagingTransport(agentId)
  return prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    const repeated = await tx.kBotFollowupJob.findMany({ where: { agentId, requestKey: input.requestKey } })
    if (repeated.length) {
      if (repeated.length !== input.candidates.length || repeated.some(j => !input.candidates.some(c => c.id === j.candidateId && c.fingerprint === j.fingerprint) || j.language !== input.language)) throw new FollowupError('REQUEST_CONFLICT')
      return { batchId: repeated[0].batchId }
    }
    const now = new Date()
    for (const c of candidates) {
      const pref = await tx.kBotContactPreference.findUnique({ where: { agentId_subjectKey: { agentId, subjectKey: c.phone! } } })
      // Every category counts, which is why the filter is on phone alone. The
      // query already encodes the window (COOLDOWN_MS === RECENCY_WINDOW_MS), so
      // a hit is recent by construction and the gate only has to see it exists.
      const recent = await tx.kBotFollowupJob.findFirst({ where: { agentId, phone: c.phone!, OR: [
        { status: { in: ACTIVE_JOB_STATES } }, { status: { in: SENT_JOB_STATES }, updatedAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
      ] } })
      const gate = evaluateSendGate({ phone: c.phone, preferences: pref ? [pref] : [],
        recentJobs: recent ? [{ sentAt: now }] : [], now, enforceQuietHours: false,
        // O agente está apertando enviar aqui: a habilitação não barra a mão dele.
        requireEnabled: false })
      if (gate.reason) throw new FollowupError(MANUAL_GATE_ERRORS[gate.reason])
    }
    await grantFreeCredits(tx, agentId, now)
    const grants = await tx.kBotCreditGrant.findMany({ where: { agentId, expiresAt: { gt: now } }, orderBy: { expiresAt: 'asc' } })
    if (availableCredits(grants) < candidates.length * TOKEN_RESERVATION) throw new FollowupError('INSUFFICIENT_CREDITS')
    const batchId = randomUUID()
    for (const c of candidates) {
      const grant = grants.find(g => g.allowance > g.spent + g.reserved)!
      const job = await tx.kBotFollowupJob.create({ data: { agentId, batchId, requestKey: input.requestKey, candidateId: c.id,
        fingerprint: c.fingerprint, customerName: c.customerName, phone: c.phone!, reason: c.reason, sourceHref: c.sourceHref,
        language: input.language, grantId: grant.id, senderIdentity: transport.identity, reservedTokens: TOKEN_RESERVATION } })
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
    }
    return { batchId }
  })
}

export async function changeContactPreference(agentId: string, candidateId: string, action: 'snooze' | 'optout' | 'restore' | 'manual') {
  const candidate = (await getFollowupCandidates(agentId)).find(c => c.id === candidateId)
  if (!candidate) throw new FollowupError('SOURCE_CHANGED')
  const subjectKey = candidate.phone ?? candidate.subjectKey
  await prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    const data = action === 'optout' ? { optedOut: true } : action === 'restore' ? { optedOut: false, snoozedUntil: null }
      : action === 'manual' ? { lastManualAt: new Date() } : { snoozedUntil: new Date(Date.now() + 86_400_000) }
    await tx.kBotContactPreference.upsert({ where: { agentId_subjectKey: { agentId, subjectKey } }, create: { agentId, subjectKey, ...data }, update: data })
    // Consent changes are logged; `manual` is not one — it records that the
    // agent spoke to the person, which silences the queue for a week but is
    // not the person asking anything.
    const logged = action === 'optout' ? 'OPT_OUT' : action === 'restore' ? 'OPT_IN' : action === 'snooze' ? 'SNOOZE' : null
    if (logged) {
      await tx.kBotContactConsentEvent.create({
        data: { agentId, subjectKey, action: logged, source: 'AGENT_UI', snoozedUntil: data.snoozedUntil ?? null },
      })
    }
    if (action === 'restore' && subjectKey !== candidate.subjectKey) {
      await tx.kBotContactPreference.updateMany({ where: { agentId, subjectKey: candidate.subjectKey }, data })
    }
    // A manual contact or opt-out also cancels queued AI work for this recipient.
    if (action === 'manual' || action === 'optout') {
      const jobs = await tx.kBotFollowupJob.findMany({ where: { agentId, phone: candidate.phone ?? '', status: { in: ['PENDING', 'PREPARING'] } } })
      for (const job of jobs) {
        if (job.status === 'PREPARING') await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'CANCEL_REQUESTED' } })
        else await settleJob(tx, job, 'CANCELLED')
      }
    }
  })
}

export async function cancelBatch(agentId: string, batchId: string) {
  return prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    const jobs = await tx.kBotFollowupJob.findMany({ where: { agentId, batchId, status: { in: ['PENDING', 'PREPARING'] } } })
    for (const job of jobs) {
      if (job.status === 'PREPARING') await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'CANCEL_REQUESTED' } })
      else await settleJob(tx, job, 'CANCELLED')
    }
    return { cancelled: jobs.length }
  })
}

export async function openManualConversation(agentId: string, candidateId: string) {
  const candidate = (await getFollowupCandidates(agentId)).find(c => c.id === candidateId)
  if (!candidate?.phone) throw new FollowupError('PHONE_REQUIRED')
  if (candidate.blockedReason === 'OPTED_OUT') throw new FollowupError('OPTED_OUT')
  const transport = await messagingTransport(agentId, false)
  const conversationId = await transport.conversation(candidate.phone, candidate.customerName)
  await transport.verifyConversation(conversationId, candidate.phone)
  return { href: `/agent/mensagens?conversation=${conversationId}` }
}

/** Repair only a missing/invalid contact number on a currently owned candidate. */
export async function saveFollowupPhone(agentId: string, input: { candidateId: string; fingerprint: string; phone: string }) {
  const phone = normalizePhone(input.phone)
  if (!phone) throw new FollowupError('PHONE_REQUIRED', 400)
  const candidate = (await getFollowupCandidates(agentId)).find(c => c.id === input.candidateId)
  if (!candidate || candidate.fingerprint !== input.fingerprint) throw new FollowupError('SOURCE_CHANGED')
  if (candidate.blockedReason !== 'PHONE_REQUIRED') throw new FollowupError(candidate.blockedReason ?? 'SOURCE_CHANGED')
  return prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    if (candidate.subjectKey.startsWith('client:')) {
      const id = candidate.subjectKey.slice('client:'.length)
      const client = await tx.client.findFirst({ where: { id, assignedAgentId: agentId }, select: { phone: true } })
      if (!client || normalizePhone(client.phone)) throw new FollowupError('SOURCE_CHANGED')
      const result = await tx.client.updateMany({ where: { id, assignedAgentId: agentId, phone: client.phone }, data: { phone } })
      if (result.count !== 1) throw new FollowupError('SOURCE_CHANGED')
    } else if (candidate.subjectKey.startsWith('case:')) {
      const id = candidate.subjectKey.slice('case:'.length)
      const insuranceCase = await tx.insuranceCase.findFirst({
        where: { id, assignedAgentId: agentId, clientId: null, status: 'OPEN', prospect: { assignedAgentId: agentId } },
        select: { prospect: { select: { id: true, phone: true } } },
      })
      if (!insuranceCase || normalizePhone(insuranceCase.prospect.phone)) throw new FollowupError('SOURCE_CHANGED')
      const result = await tx.prospect.updateMany({ where: {
        id: insuranceCase.prospect.id, assignedAgentId: agentId, phone: insuranceCase.prospect.phone,
        cases: { some: { id, assignedAgentId: agentId, clientId: null, status: 'OPEN' } },
      }, data: { phone } })
      if (result.count !== 1) throw new FollowupError('SOURCE_CHANGED')
    } else throw new FollowupError('SOURCE_CHANGED')
    return { ok: true }
  })
}
