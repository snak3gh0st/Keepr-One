import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/kbot-followup/domain'
import {
  BLOCKED,
  DELIVERED,
  DELIVERING,
  FAILED,
  GENERATING,
  GENERATION_WINDOW_MS,
  type DeliveryRefusal,
  type IllustrationDeliveryEnvelope,
} from './domain'

/// Carrier numbers going back to the client who asked for them.
///
/// The only gate is consent. There is no approval queue: the client asked a
/// question in a conversation and this is the answer, so making them wait for
/// the agent to read it first would turn a reply into a delay.
///
/// Quiet hours are deliberately not applied either — they exist so an
/// unprompted birthday greeting does not arrive at 3am, and a reply to a
/// message the client just sent is not unprompted.

/// The carrier finished and the numbers are on the illustration: send them.
///
/// Claims the request out of GENERATING with an `updateMany` predicate, so two
/// completion events for the same run cannot both deliver. A claim that matches
/// nothing means someone else already took it, which is not an error.
export async function deliverGeneratedIllustration(
  input: { agentId: string; illustrationId: string; now?: Date },
  send: (envelope: IllustrationDeliveryEnvelope) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: DeliveryRefusal }> {
  const now = input.now ?? new Date()
  const request = await prisma.kBotIllustrationRequest.findFirst({
    where: { agentId: input.agentId, illustrationId: input.illustrationId, status: GENERATING },
    select: { id: true, clientId: true },
  })
  // An illustration the agent ran by hand has no request behind it, and this is
  // simply not about it.
  if (!request) return { ok: false, reason: 'NOT_GENERATING' }

  const claimed = await prisma.kBotIllustrationRequest.updateMany({
    where: { id: request.id, agentId: input.agentId, status: GENERATING },
    data: { status: DELIVERING },
  })
  if (claimed.count === 0) return { ok: false, reason: 'NOT_GENERATING' }

  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: { user: { select: { language: true } } },
  })
  const client = await prisma.client.findFirst({
    where: { id: request.clientId, assignedAgentId: input.agentId },
    select: { id: true, name: true, phone: true },
  })
  const phone = normalizePhone(client?.phone)
  if (!client || !phone) {
    await close(request.id, input.agentId, FAILED, 'CLIENT_UNREACHABLE', now)
    return { ok: false, reason: 'CLIENT_UNREACHABLE' }
  }

  // Consent outlives the request. Someone may have asked for a quote last week
  // and asked to be left alone since; the second instruction is the current one.
  // Checked here rather than at dispatch time because the carrier run takes
  // minutes, and a stop request can arrive inside them.
  const preferences = await prisma.kBotContactPreference.findMany({
    where: { agentId: input.agentId, subjectKey: { in: [phone, `client:${client.id}`] } },
    select: { optedOut: true },
  })
  if (preferences.some((preference) => preference.optedOut)) {
    await close(request.id, input.agentId, BLOCKED, 'OPTED_OUT', now)
    return { ok: false, reason: 'OPTED_OUT' }
  }

  const illustration = await prisma.illustration.findFirst({
    where: { id: input.illustrationId, agentId: input.agentId },
    select: { id: true, productName: true, faceAmount: true, targetPremium: true, documentUrl: true },
  })
  if (!illustration) {
    await close(request.id, input.agentId, FAILED, 'ILLUSTRATION_MISSING', now)
    return { ok: false, reason: 'ILLUSTRATION_MISSING' }
  }

  try {
    await send({
      requestId: request.id,
      agentId: input.agentId,
      clientId: client.id,
      clientName: client.name,
      phone,
      language: agent?.user.language ?? 'PT',
      illustrationId: illustration.id,
      productName: illustration.productName,
      faceAmount: illustration.faceAmount?.toString() ?? null,
      targetPremium: illustration.targetPremium?.toString() ?? null,
      documentUrl: illustration.documentUrl,
    })
  } catch (error) {
    // Never the carrier's figures in a log line.
    console.error('KBOT_ILLUSTRATION_DELIVERY_FAILED', {
      requestId: request.id,
      errorName: error instanceof Error ? error.name : typeof error,
    })
    await close(request.id, input.agentId, FAILED, 'TRANSPORT_FAILED', now)
    return { ok: false, reason: 'TRANSPORT_FAILED' }
  }

  await prisma.kBotIllustrationRequest.updateMany({
    where: { id: request.id, agentId: input.agentId, status: DELIVERING },
    data: { status: DELIVERED, deliveredAt: now, closedAt: now },
  })

  // This message is not a KBotFollowupJob, so the shared weekly window would
  // not see it — and a birthday greeting could land two hours after the quote.
  // `lastManualAt` is the field the gate already reads for "this person was
  // contacted"; the bot answering on the agent's line is that, whoever typed.
  // Best effort: the quote is already delivered, and failing here would be
  // reported as a delivery failure that did not happen.
  try {
    await prisma.kBotContactPreference.upsert({
      where: { agentId_subjectKey: { agentId: input.agentId, subjectKey: phone } },
      create: { agentId: input.agentId, subjectKey: phone, lastManualAt: now },
      update: { lastManualAt: now },
    })
  } catch {
    // Intentionally swallowed.
  }
  return { ok: true }
}

async function close(
  requestId: string,
  agentId: string,
  status: string,
  safeErrorCode: string,
  now: Date,
): Promise<void> {
  await prisma.kBotIllustrationRequest.updateMany({
    where: { id: requestId, agentId, status: DELIVERING },
    data: { status, safeErrorCode, closedAt: now },
  })
}

/// Release slots whose connector run never finished.
///
/// Without this a dead run would hold the client-and-product slot forever and
/// the client could never ask again.
export async function expireStaleIllustrationRequests(now = new Date()): Promise<{ expired: number }> {
  const abandoned = await prisma.kBotIllustrationRequest.updateMany({
    where: { status: GENERATING, createdAt: { lt: new Date(now.getTime() - GENERATION_WINDOW_MS) } },
    data: { status: FAILED, closedAt: now, safeErrorCode: 'GENERATION_TIMED_OUT' },
  })
  return { expired: abandoned.count }
}
