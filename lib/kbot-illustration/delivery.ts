import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/kbot-followup/domain'
import { IllustrationTransportError } from './transport'
import {
  BLOCKED,
  DISCARDED,
  READY_TO_SEND,
  SEND_WINDOW_MS,
  EXPIRED,
  DELIVERED,
  DELIVERING,
  FAILED,
  GENERATING,
  GENERATION_WINDOW_MS,
  type DeliveryRefusal,
  type IllustrationDeliveryEnvelope,
} from './domain'

/// Carrier numbers reaching the client, once a person says so.
///
/// Generating costs a carrier run and produces a document inside Keeprone;
/// sending it puts text on someone's phone. Only the second one is gated, and
/// the gate is the agent pressing send — `markIllustrationReadyToSend` is what
/// the connector's completion calls, and it stops there.
///
/// Quiet hours are deliberately not applied: they exist so an unprompted
/// birthday greeting does not arrive at 3am, and an agent choosing to send is
/// already choosing the moment.

/// The carrier finished and the numbers are on the illustration.
///
/// Moves the request to READY_TO_SEND and stops. Nothing is sent here — this is
/// the point at which the agent has something to look at.
export async function markIllustrationReadyToSend(input: {
  agentId: string
  illustrationId: string
}): Promise<{ moved: number }> {
  // An illustration the agent ran by hand has no request behind it, and this is
  // simply not about it.
  const result = await prisma.kBotIllustrationRequest.updateMany({
    where: { agentId: input.agentId, illustrationId: input.illustrationId, status: GENERATING },
    data: { status: READY_TO_SEND },
  })
  return { moved: result.count }
}

/// The agent read the numbers and chose to send them.
///
/// The `updateMany` predicate is the authority: the owning agent, the waiting
/// state and the send window are all re-checked, so a stale screen sending
/// something already sent, discarded or expired matches nothing. Consent is
/// checked after the claim, because a stop request can arrive at any point and
/// the client's instruction outranks the agent's click.
export async function sendIllustrationRequest(
  input: { agentId: string; requestId: string; now?: Date },
  send: (envelope: IllustrationDeliveryEnvelope) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: DeliveryRefusal }> {
  const now = input.now ?? new Date()
  const claimed = await prisma.kBotIllustrationRequest.updateMany({
    where: {
      id: input.requestId,
      agentId: input.agentId,
      status: READY_TO_SEND,
      createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) },
    },
    data: { status: DELIVERING },
  })
  if (claimed.count === 0) return { ok: false, reason: 'NOT_READY_TO_SEND' }

  const request = await prisma.kBotIllustrationRequest.findFirst({
    where: { id: input.requestId, agentId: input.agentId },
    select: { id: true, clientId: true, illustrationId: true },
  })
  if (!request?.illustrationId) {
    await close(input.requestId, input.agentId, FAILED, 'ILLUSTRATION_MISSING', now)
    return { ok: false, reason: 'ILLUSTRATION_MISSING' }
  }

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

  // Consent outranks the agent's click. Someone may have asked for a quote last
  // week and asked to be left alone since; the second instruction is the
  // current one, and it is read here rather than when the screen was drawn.
  const preferences = await prisma.kBotContactPreference.findMany({
    where: { agentId: input.agentId, subjectKey: { in: [phone, `client:${client.id}`] } },
    select: { optedOut: true },
  })
  if (preferences.some((preference) => preference.optedOut)) {
    await close(request.id, input.agentId, BLOCKED, 'OPTED_OUT', now)
    return { ok: false, reason: 'OPTED_OUT' }
  }

  const illustration = await prisma.illustration.findFirst({
    where: { id: request.illustrationId, agentId: input.agentId },
    select: { id: true, productName: true, faceAmount: true, premium: true, targetPremium: true, documentUrl: true },
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
      premium: illustration.premium?.toString() ?? null,
      targetPremium: illustration.targetPremium?.toString() ?? null,
      documentUrl: illustration.documentUrl,
    })
  } catch (error) {
    // A missing document and a provider outage are different sentences on the
    // screen: one is "this quote has no PDF", the other is "WhatsApp is down,
    // try again". Collapsing them would send the agent looking for the wrong
    // problem.
    const reason: DeliveryRefusal = error instanceof IllustrationTransportError
      && error.code === 'DOCUMENT_MISSING' ? 'ILLUSTRATION_MISSING' : 'TRANSPORT_FAILED'
    // Never the carrier's figures in a log line.
    console.error('KBOT_ILLUSTRATION_DELIVERY_FAILED', {
      requestId: request.id,
      reason,
      errorName: error instanceof Error ? error.name : typeof error,
    })
    await close(request.id, input.agentId, FAILED, reason, now)
    return { ok: false, reason }
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

/// The agent decided not to send these numbers.
///
/// Lives next to `sendIllustrationRequest` rather than in the screen's action,
/// because the two decide the same row and a predicate written twice is a
/// predicate that drifts. Guarded the same way: the owning agent and the
/// waiting state, so a stale screen discarding something already sent matches
/// nothing.
export async function discardIllustrationRequest(input: {
  agentId: string
  requestId: string
  now?: Date
}): Promise<{ discarded: number }> {
  const now = input.now ?? new Date()
  const result = await prisma.kBotIllustrationRequest.updateMany({
    where: { id: input.requestId, agentId: input.agentId, status: READY_TO_SEND },
    data: { status: DISCARDED, closedAt: now, safeErrorCode: 'DISCARDED_BY_AGENT' },
  })
  return { discarded: result.count }
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
  // Numbers nobody sent within the window stop being sendable. The carrier's
  // assumptions age, and a quote going out a week late over the agent's name is
  // worse than one that was never sent.
  const unsent = await prisma.kBotIllustrationRequest.updateMany({
    where: { status: READY_TO_SEND, createdAt: { lt: new Date(now.getTime() - SEND_WINDOW_MS) } },
    data: { status: EXPIRED, closedAt: now, safeErrorCode: 'SEND_WINDOW_EXPIRED' },
  })
  return { expired: abandoned.count + unsent.count }
}
