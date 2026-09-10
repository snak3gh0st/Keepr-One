import 'server-only'
import type { KBotFollowupJob } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { lockAgent, settleJob, type Tx } from '@/lib/kbot-followup/credits'
import { FollowupError } from '@/lib/kbot-followup/domain'
import { hasRecentOutgoing, messagingTransport, requestedOptOut } from '@/lib/kbot-followup/transport'
import { evaluateSendGate } from './send-gate'
import { SCHEDULED_CATEGORIES } from './scheduled-triggers'

const LEASE_MS = 120_000
const unconfirmedStates = ['DISPATCHING', 'ACCEPTED', 'UNKNOWN']

/// The agent's own text, with the client's name in it.
///
/// Deliberately the only substitution there is. A scheduled message goes out
/// over the agent's name without anyone reading it first, so the template is
/// the message — nothing here composes prose the agent has not seen.
export function renderTemplate(body: string, values: { customerName: string }): string {
  return body.replace(/\{\{\s*name\s*\}\}/gi, values.customerName)
}

/// Record a stop request before it scrolls out of the provider's history.
///
/// The consent trail is append-only: this writes a new event and never edits
/// one, so "when did they ask, and how" survives the preference row being
/// flipped back later.
async function recordOptOut(agentId: string, phone: string, evidence: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockAgent(tx, agentId)
    await tx.kBotContactPreference.upsert({
      where: { agentId_subjectKey: { agentId, subjectKey: phone } },
      create: { agentId, subjectKey: phone, optedOut: true },
      update: { optedOut: true },
    })
    await tx.kBotContactConsentEvent.create({
      data: { agentId, subjectKey: phone, action: 'OPT_OUT', source: 'WHATSAPP_REPLY', evidence },
    })
  })
}

/// Give the reservation back at the moment of sending.
///
/// A template send calls no model, so it spends nothing. The reservation exists
/// only to bound how much a trigger can queue in one day, and by dispatch time
/// it has already done that job. Holding it past here would leak the agent's
/// monthly grant one message at a time — an ACCEPTED job is never settled, so
/// nothing downstream would ever hand the tokens back.
async function releaseReservation(tx: Tx, job: KBotFollowupJob) {
  if (job.creditState !== 'RESERVED') return
  const allocations = await tx.kBotCreditAllocation.findMany({ where: { jobId: job.id } })
  for (const allocation of allocations) {
    await tx.kBotCreditGrant.update({ where: { id: allocation.grantId }, data: {
      reserved: { decrement: allocation.reservedTokens },
    } })
  }
  await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { creditState: 'RELEASED' } })
}

async function terminal(id: string, status: string, errorCode?: string, providerId?: string) {
  const owner = await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id }, select: { agentId: true } })
  await prisma.$transaction(async (tx) => {
    await lockAgent(tx, owner.agentId)
    const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id } })
    if (['FAILED', 'CANCELLED', 'SENT', 'DELIVERED', 'READ'].includes(job.status)) return
    await settleJob(tx, job, status, errorCode, providerId)
  })
}

/// What one turn of the worker did.
///
/// `DEFERRED` is not a failure and not work: the job went back on the queue for
/// a later hour. A caller draining the queue has to be able to tell it apart
/// from `WORKED`, because a deferred job is still the oldest PENDING row — a
/// loop that only asked "did something happen" would re-claim it every turn and
/// never reach anything behind it.
export type ScheduledTurn =
  | { outcome: 'IDLE' }
  | { outcome: 'WORKED' | 'DEFERRED'; id: string }

/// Claim and send one scheduled message.
///
/// Safe to run concurrently: the claim is a `FOR UPDATE SKIP LOCKED` read, so
/// two workers racing take two different rows rather than blocking or, worse,
/// both taking the same one. `skipIds` lets one drain pass step over the jobs it
/// has already deferred this run; it is not a lock and does not need to be.
export async function processNextScheduledMessage(skipIds: readonly string[] = []): Promise<ScheduledTurn> {
  const claimed = await prisma.$transaction(async (tx) => {
    const now = new Date()
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "KBotFollowupJob"
      WHERE "status" = 'PENDING' AND "category" = ANY(${[...SCHEDULED_CATEGORIES]})
        AND NOT ("id" = ANY(${[...skipIds]}))
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED LIMIT 1`
    if (!rows[0]) return null
    // Deliberately no `generationStartedAt`: nothing is generated here, and the
    // manual path counts that column across the whole table to enforce its
    // daily model-call ceiling. Stamping it would let a busy birthday morning
    // spend the platform's generation budget and shut off real follow-ups.
    return tx.kBotFollowupJob.update({ where: { id: rows[0].id }, data: {
      status: 'PREPARING', leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    } })
  })
  if (!claimed) return { outcome: 'IDLE' }

  let dispatched = false
  try {
    const agent = await prisma.agent.findUnique({ where: { id: claimed.agentId }, include: { user: true } })
    if (!agent || agent.status !== 'ACTIVE' || agent.user.banned) throw new FollowupError('AGENT_UNAVAILABLE')

    // The template is re-read at send time, not trusted from enqueue: an agent
    // who disabled it since is an agent who withdrew the text.
    const template = await prisma.kBotMessageTemplate.findUnique({
      where: { agentId_category_language: { agentId: claimed.agentId, category: claimed.category, language: claimed.language } },
    })
    if (!template?.enabled) throw new FollowupError('TEMPLATE_MISSING')

    const transport = await messagingTransport(claimed.agentId)
    const conversationId = await transport.conversation(claimed.phone, claimed.customerName)
    await transport.verifyConversation(conversationId, claimed.phone)
    const messages = await transport.messages(conversationId)
    if (requestedOptOut(messages)) {
      await recordOptOut(claimed.agentId, claimed.phone, null)
      throw new FollowupError('OPTED_OUT')
    }
    if (hasRecentOutgoing(messages)) throw new FollowupError('RECENT_CONTACT')

    const content = renderTemplate(template.body, { customerName: claimed.customerName })

    const dispatch = await prisma.$transaction(async (tx) => {
      await lockAgent(tx, claimed.agentId)
      const job = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: claimed.id } })
      // A lease that expired while the provider was slow means another worker
      // may already own this job. Losing the race is not an error.
      if (job.status !== 'PREPARING' || !job.leaseExpiresAt || job.leaseExpiresAt < new Date()) return 'LOST' as const
      const preferences = await tx.kBotContactPreference.findMany({
        where: { agentId: job.agentId, subjectKey: job.phone },
      })
      // The hour is checked again here, against the moment of sending. A job
      // queued inside the window but held up in a backlog must not go out at
      // midnight just because it was fine when it was enqueued.
      const gate = evaluateSendGate({
        phone: job.phone, preferences, recentJobs: [], now: new Date(), enforceQuietHours: true,
      })
      if (gate.reason) {
        // Quiet hours are a "not yet", not a "never": leave it PENDING for the
        // next pass instead of burning the day's only chance to greet them. An
        // opt-out or a snooze, by contrast, is an answer — that one is settled.
        if (gate.reason === 'QUIET_HOURS') {
          await tx.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'PENDING', leaseExpiresAt: null } })
          return 'DEFERRED' as const
        }
        await settleJob(tx, job, 'CANCELLED', gate.reason)
        return 'CANCELLED' as const
      }
      await releaseReservation(tx, job)
      await tx.kBotFollowupJob.update({ where: { id: job.id }, data: {
        status: 'DISPATCHING', content, conversationId, senderIdentity: transport.identity, leaseExpiresAt: null,
      } })
      return 'SEND' as const
    })
    if (dispatch === 'DEFERRED') return { outcome: 'DEFERRED', id: claimed.id }
    if (dispatch !== 'SEND') return { outcome: 'WORKED', id: claimed.id }

    dispatched = true
    const receipt = await transport.send(conversationId, content, claimed.id, claimed.phone)
    if (receipt.status) {
      await terminal(claimed.id, receipt.status, receipt.status === 'FAILED' ? 'PROVIDER_FAILED' : undefined, receipt.sourceId ?? undefined)
    } else {
      await prisma.kBotFollowupJob.updateMany({ where: { id: claimed.id, status: { in: unconfirmedStates } }, data: {
        status: receipt.id || receipt.sourceId ? 'ACCEPTED' : 'UNKNOWN', messageId: receipt.id, providerMessageId: receipt.sourceId,
      } })
    }
  } catch (error) {
    // Once the provider has been handed the text, a retry could send it twice.
    // An unconfirmed send stays unconfirmed rather than being retried.
    if (dispatched) {
      await prisma.kBotFollowupJob.updateMany({ where: { id: claimed.id, status: { in: unconfirmedStates } }, data: {
        status: 'UNKNOWN', errorCode: 'SEND_UNCONFIRMED',
      } })
    } else {
      await terminal(claimed.id, 'FAILED', error instanceof FollowupError ? error.code : 'PREPARATION_FAILED')
    }
  }
  return { outcome: 'WORKED', id: claimed.id }
}

/// Release scheduled jobs whose worker died mid-lease.
export async function releaseExpiredScheduledLeases(now = new Date()) {
  const { count } = await prisma.kBotFollowupJob.updateMany({
    where: { status: 'PREPARING', category: { in: [...SCHEDULED_CATEGORIES] }, leaseExpiresAt: { lt: now } },
    data: { status: 'PENDING', leaseExpiresAt: null },
  })
  return count
}
