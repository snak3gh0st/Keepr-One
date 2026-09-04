import 'server-only'
import { prisma } from '@/lib/prisma'
import { requireFounderAccessForAgent } from '@/lib/founder-access'
import { getFollowupCandidates } from './candidates'
import { generateFollowup, GenerationFailure } from './generation'
import { lockAgent, settleJob, settleGeneration } from './credits'
import { aiEnabled, FollowupError, positiveInteger, type FollowupReason } from './domain'
import { hasRecentOutgoing, messagingTransport, providerOutcome, requestedOptOut } from './transport'

const receiptProgress: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 }
const unconfirmedStates = ['DISPATCHING', 'ACCEPTED', 'UNKNOWN']

async function checkOptOut(agentId: string, phone: string, messages: Parameters<typeof requestedOptOut>[0]) {
  if (!requestedOptOut(messages)) return
  // Preserve the request after the incoming STOP scrolls out of provider history.
  await prisma.$transaction(async tx => {
    await lockAgent(tx, agentId)
    await tx.kBotContactPreference.upsert({ where: { agentId_subjectKey: { agentId, subjectKey: phone } },
      create: { agentId, subjectKey: phone, optedOut: true }, update: { optedOut: true } })
  })
  throw new FollowupError('OPTED_OUT')
}

async function terminal(id: string, status: string, error?: string, providerId?: string) {
  const owner = await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id }, select: { agentId: true } })
  await prisma.$transaction(async tx => {
    await lockAgent(tx, owner.agentId)
    const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id } })
    if (['FAILED', 'CANCELLED', 'READ'].includes(job.status)) return
    // Delivery receipts may arrive after the first send confirmation. Keep
    // progress monotonic when multiple server instances reconcile the same job.
    if (receiptProgress[job.status] && (receiptProgress[status] ?? 0) <= receiptProgress[job.status]) return
    await settleJob(tx, job, status, error, providerId)
  })
}

export async function reconcileFollowups() {
  const jobs = await prisma.kBotFollowupJob.findMany({ where: { status: { in: [...unconfirmedStates, 'SENT', 'DELIVERED'] },
    createdAt: { gte: new Date(Date.now() - 86_400_000) },
    updatedAt: { lt: new Date(Date.now() - 30_000) } }, orderBy: { updatedAt: 'asc' }, take: 10 })
  for (const job of jobs) {
    if (!job.conversationId) continue
    try {
      const transport = await messagingTransport(job.agentId, false)
      if (transport.identity !== job.senderIdentity) {
        await prisma.kBotFollowupJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { updatedAt: new Date() } })
        continue
      }
      await transport.verifyConversation(job.conversationId, job.phone)
      let before: string | undefined
      let found = false
      // Never infer delivery from message text. Match exact gateway id or durable correlation metadata.
      for (let page = 0; page < 10; page++) {
        const messages = await transport.messages(job.conversationId, before)
        const m = messages.find(m => (job.messageId && String(m.id) === job.messageId) ||
          (m.content_attributes as Record<string, unknown> | undefined)?.kbot_followup_id === job.id)
        if (m) {
          found = true
          const outcome = providerOutcome(m)
          if (outcome) await terminal(job.id, outcome, outcome === 'FAILED' ? 'PROVIDER_FAILED' : undefined, String(m.source_id ?? ''))
          else await prisma.kBotFollowupJob.updateMany({ where: { id: job.id, status: { in: unconfirmedStates } }, data: { status: Date.now() - job.createdAt.getTime() > 600_000 ? 'UNKNOWN' : 'ACCEPTED', messageId: String(m.id),
            errorCode: Date.now() - job.createdAt.getTime() > 600_000 ? 'SEND_UNCONFIRMED' : null } })
          break
        }
        if (!messages.length) break
        before = String(Math.min(...messages.map(m => Number(m.id))))
      }
      if (!found) await prisma.kBotFollowupJob.updateMany({ where: { id: job.id, status: { in: unconfirmedStates } }, data: { status: 'UNKNOWN', errorCode: 'SEND_UNCONFIRMED' } })
      // Rotate checked jobs even if the provider has no newer receipt. Otherwise
      // ten unchanged SENT jobs would starve the rest of the reconciliation queue.
      await prisma.kBotFollowupJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { updatedAt: new Date() } })
    } catch {
      // Retain the outcome on provider failure, but let other jobs be checked.
      await prisma.kBotFollowupJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { updatedAt: new Date() } })
    }
  }
}

export async function processNextFollowup() {
  if (!aiEnabled()) return false
  const claimed = await prisma.$transaction(async tx => {
    // Global serialization makes the daily API-call ceiling valid across server instances.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kbot-followup-generation'))`
    const now = new Date()
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "KBotFollowupJob" WHERE "status" = 'PENDING' ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: rows[0].id } })
    const day = new Date(now.toISOString().slice(0, 10))
    const count = await tx.kBotFollowupJob.count({ where: { generationStartedAt: { gte: day } } })
    if (count >= positiveInteger(process.env.KBOT_FOLLOWUP_DAILY_GENERATIONS, 1000)) return null
    // Reservation grants also bound generation attempts, including refunded failures.
    const grant = job.grantId ? await tx.kBotCreditGrant.findUnique({ where: { id: job.grantId } }) : null
    const attempts = await tx.kBotFollowupJob.count({ where: { grantId: job.grantId, generationStartedAt: { not: null } } })
    if (!grant || grant.expiresAt <= now || attempts >= Math.max(1, Math.ceil(grant.allowance / 128))) {
      await lockAgent(tx, job.agentId)
      await settleJob(tx, job, 'FAILED', 'GENERATION_LIMIT')
      return null
    }
    return tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'PREPARING', generationStartedAt: now, leaseExpiresAt: new Date(now.getTime() + 120_000) } })
  })
  if (!claimed) return false
  let dispatched = false
  try {
    const agent = await prisma.agent.findUnique({ where: { id: claimed.agentId }, include: { user: true } })
    if (!agent || agent.status !== 'ACTIVE' || agent.user.banned) throw new FollowupError('AGENT_UNAVAILABLE')
    if (agent.user.role !== 'ADMIN') await requireFounderAccessForAgent(agent.id)
    const current = (await getFollowupCandidates(claimed.agentId)).find(c => c.id === claimed.candidateId)
    if (!current || current.fingerprint !== claimed.fingerprint || (current.blockedReason && current.blockedReason !== 'RECENT_CONTACT')) throw new FollowupError('SOURCE_CHANGED')
    const transport = await messagingTransport(claimed.agentId)
    if (transport.identity !== claimed.senderIdentity) throw new FollowupError('SENDER_CHANGED')
    const conversationId = await transport.conversation(claimed.phone, claimed.customerName)
    await transport.verifyConversation(conversationId, claimed.phone)
    const priorMessages = await transport.messages(conversationId)
    await checkOptOut(claimed.agentId, claimed.phone, priorMessages)
    if (hasRecentOutgoing(priorMessages)) throw new FollowupError('RECENT_CONTACT')
    const result = await generateFollowup({ customerName: claimed.customerName, agentName: agent.user.name,
      reason: claimed.reason as FollowupReason, language: claimed.language as 'PT' | 'EN' })
    await prisma.$transaction(async tx => {
      await lockAgent(tx, claimed.agentId)
      const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: claimed.id } })
      // Generation completed even if cancellation raced it: tokens were consumed.
      if (job.creditState === 'RESERVED') await settleGeneration(tx, job, result.inputTokens, result.outputTokens)
      await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { ...result, conversationId } })
      if (job.status === 'CANCEL_REQUESTED') await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', leaseExpiresAt: null } })
    })
    // Recheck source after generation; the carrier may have been synchronized meanwhile.
    const fresh = (await getFollowupCandidates(claimed.agentId)).find(c => c.id === claimed.candidateId)
    if (!fresh || fresh.fingerprint !== claimed.fingerprint || (fresh.blockedReason && fresh.blockedReason !== 'RECENT_CONTACT')) throw new FollowupError('SOURCE_CHANGED')
    const ready = await messagingTransport(claimed.agentId)
    if (ready.identity !== claimed.senderIdentity) throw new FollowupError('SENDER_CHANGED')
    await ready.verifyConversation(conversationId, claimed.phone)
    const latestMessages = await ready.messages(conversationId)
    await checkOptOut(claimed.agentId, claimed.phone, latestMessages)
    if (hasRecentOutgoing(latestMessages)) throw new FollowupError('RECENT_CONTACT')
    const dispatch = await prisma.$transaction(async tx => {
      await lockAgent(tx, claimed.agentId)
      const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: claimed.id } })
      if (job.status !== 'PREPARING' || !job.leaseExpiresAt || job.leaseExpiresAt < new Date()) return false
      const preference = await tx.kBotContactPreference.findUnique({ where: { agentId_subjectKey: { agentId: job.agentId, subjectKey: job.phone } } })
      if (preference?.optedOut || (preference?.lastManualAt && preference.lastManualAt >= job.createdAt)) {
        await settleJob(tx, job, 'CANCELLED', 'CONTACT_UNAVAILABLE'); return false
      }
      await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'DISPATCHING', leaseExpiresAt: null } })
      return true
    })
    if (!dispatch) return true
    dispatched = true
    const receipt = await ready.send(conversationId, result.content, claimed.id)
    await prisma.kBotFollowupJob.updateMany({ where: { id: claimed.id, status: { in: unconfirmedStates } }, data: {
      status: receipt.id ? 'ACCEPTED' : 'UNKNOWN', messageId: receipt.id, providerMessageId: receipt.sourceId,
    } })
  } catch (error) {
    if (error instanceof GenerationFailure) {
      await prisma.$transaction(async tx => {
        await lockAgent(tx, claimed.agentId)
        const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: claimed.id } })
        await settleGeneration(tx, job, error.usage.inputTokens, error.usage.outputTokens)
      })
    }
    if (dispatched) {
      await prisma.kBotFollowupJob.updateMany({ where: { id: claimed.id, status: { in: unconfirmedStates } }, data: { status: 'UNKNOWN', errorCode: 'SEND_UNCONFIRMED' } })
    } else {
      await terminal(claimed.id, 'FAILED', error instanceof FollowupError ? error.code : 'PREPARATION_FAILED')
    }
  }
  return true
}

export async function maintainFollowups() {
  const stalePending = await prisma.kBotFollowupJob.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 86_400_000) } }, take: 25 })
  for (const job of stalePending) await terminal(job.id, 'CANCELLED', 'AUTHORIZATION_EXPIRED')
  await prisma.kBotFollowupJob.updateMany({ where: { status: { in: ['ACCEPTED', 'DISPATCHING'] }, createdAt: { lt: new Date(Date.now() - 86_400_000) } }, data: { status: 'UNKNOWN', errorCode: 'SEND_UNCONFIRMED' } })
  const expired = await prisma.kBotFollowupJob.findMany({ where: { status: { in: ['PREPARING', 'CANCEL_REQUESTED'] }, leaseExpiresAt: { lt: new Date() } }, take: 25 })
  for (const job of expired) await terminal(job.id, 'FAILED', 'PREPARATION_EXPIRED')
  await reconcileFollowups()
  const jobs = await prisma.kBotFollowupJob.findMany({ where: { notifiedAt: null, status: { in: ['SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED', 'UNKNOWN'] } }, take: 50,
    select: { batchId: true, agentId: true } })
  for (const batch of new Map(jobs.map(j => [j.batchId, j])).values()) {
    await prisma.$transaction(async tx => {
      await lockAgent(tx, batch.agentId)
      const all = await tx.kBotFollowupJob.findMany({ where: batch })
      if (all.some(j => ['PENDING', 'PREPARING', 'CANCEL_REQUESTED', 'DISPATCHING', 'ACCEPTED'].includes(j.status))) return
      const agent = await tx.agent.findUniqueOrThrow({ where: { id: batch.agentId }, include: { user: true } })
      const sent = all.filter(j => ['SENT', 'DELIVERED', 'READ'].includes(j.status)).length
      const unknown = all.filter(j => j.status === 'UNKNOWN').length
      const failed = all.filter(j => j.status === 'FAILED').length
      const cancelled = all.filter(j => j.status === 'CANCELLED').length
      const pt = agent.user.language === 'PT'
      const message = pt ? `${sent} enviadas; ${failed} não enviadas; ${cancelled} canceladas; ${unknown} aguardando confirmação. Consulte os detalhes.`
        : `${sent} sent; ${failed} not sent; ${cancelled} cancelled; ${unknown} awaiting confirmation. View details.`
      await tx.notification.upsert({ where: { dedupeKey: `kbot-followup:${batch.batchId}` }, create: {
        recipientUserId: agent.userId, type: 'KBOT_FOLLOWUP_RESULT', title: pt ? 'Resultado do follow-up' : 'Follow-up result',
        message,
        href: '/agent/kbot', dedupeKey: `kbot-followup:${batch.batchId}`,
      }, update: { message } })
      await tx.kBotFollowupJob.updateMany({ where: batch, data: { notifiedAt: new Date() } })
    })
  }
}
