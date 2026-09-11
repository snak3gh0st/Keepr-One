import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  APPROVAL_WINDOW_MS,
  APPROVED,
  AWAITING_APPROVAL,
  DELIVERED,
  DELIVERING,
  DISCARDED,
  EXPIRED,
  FAILED,
  GENERATING,
  GENERATION_WINDOW_MS,
  type ApprovedIllustration,
  type DeliveryRefusal,
  type IllustrationDeliveryEnvelope,
} from './domain'

/// The gate between generated numbers and the client.
///
/// This module is the only place that can produce an `ApprovedIllustration`,
/// and `deliverApprovedIllustration` is the only function that accepts one.
/// A caller that tries to deliver a raw request id does not fail at runtime —
/// it does not compile.

export type ApprovalRefusal = 'NOT_AWAITING_APPROVAL'

/// The connector finished and the numbers are on the illustration.
///
/// Exported as its own transition so the completion callsite has one thing to
/// call, and so the move out of GENERATING is testable on its own. It is
/// scoped by agent and only ever moves a request that is still generating.
export async function markIllustrationReadyForApproval(input: {
  agentId: string
  illustrationId: string
  now?: Date
}): Promise<{ moved: number }> {
  const result = await prisma.kBotIllustrationRequest.updateMany({
    where: { agentId: input.agentId, illustrationId: input.illustrationId, status: GENERATING },
    data: { status: AWAITING_APPROVAL },
  })
  return { moved: result.count }
}

/// The agent read the numbers and released them.
///
/// The `updateMany` predicate is the authority: it re-checks the owning agent,
/// the awaiting state, the approval window and that an illustration is actually
/// attached. A stale screen approving a request that was discarded, expired or
/// already delivered simply matches nothing, and no approval is minted.
export async function approveIllustrationRequest(input: {
  agentId: string
  requestId: string
  approvedByUserId: string
  now?: Date
}): Promise<{ ok: true; approved: ApprovedIllustration } | { ok: false; reason: ApprovalRefusal }> {
  const now = input.now ?? new Date()
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.kBotIllustrationRequest.updateMany({
      where: {
        id: input.requestId,
        agentId: input.agentId,
        status: AWAITING_APPROVAL,
        illustrationId: { not: null },
        createdAt: { gte: new Date(now.getTime() - APPROVAL_WINDOW_MS) },
      },
      data: { status: APPROVED, approvedAt: now, approvedByUserId: input.approvedByUserId },
    })
    if (result.count === 0) return null
    return tx.kBotIllustrationRequest.findFirst({
      where: { id: input.requestId, agentId: input.agentId },
      select: { id: true, agentId: true, clientId: true, illustrationId: true },
    })
  })
  if (!claimed?.illustrationId) return { ok: false, reason: 'NOT_AWAITING_APPROVAL' }
  const approved = {
    requestId: claimed.id,
    agentId: claimed.agentId,
    clientId: claimed.clientId,
    illustrationId: claimed.illustrationId,
    approvedByUserId: input.approvedByUserId,
  } as ApprovedIllustration
  return { ok: true, approved }
}

/// The agent read the numbers and decided against them.
export async function discardIllustrationRequest(input: {
  agentId: string
  requestId: string
  now?: Date
}): Promise<{ discarded: number }> {
  const now = input.now ?? new Date()
  const result = await prisma.kBotIllustrationRequest.updateMany({
    where: {
      id: input.requestId,
      agentId: input.agentId,
      status: { in: [GENERATING, AWAITING_APPROVAL, APPROVED] },
    },
    data: { status: DISCARDED, closedAt: now, safeErrorCode: 'DISCARDED_BY_AGENT' },
  })
  return { discarded: result.count }
}

/// Release slots nobody acted on.
///
/// Two failures without this. A generation whose connector run died would hold
/// the client-and-product slot forever, so the agent could never ask again; and
/// numbers nobody read for days would stay deliverable long after the carrier
/// assumptions behind them stopped being current.
export async function expireStaleIllustrationRequests(now = new Date()): Promise<{ expired: number }> {
  const abandonedGeneration = await prisma.kBotIllustrationRequest.updateMany({
    where: { status: GENERATING, createdAt: { lt: new Date(now.getTime() - GENERATION_WINDOW_MS) } },
    data: { status: FAILED, closedAt: now, safeErrorCode: 'GENERATION_TIMED_OUT' },
  })
  const unread = await prisma.kBotIllustrationRequest.updateMany({
    where: {
      status: { in: [AWAITING_APPROVAL, APPROVED] },
      createdAt: { lt: new Date(now.getTime() - APPROVAL_WINDOW_MS) },
    },
    data: { status: EXPIRED, closedAt: now, safeErrorCode: 'APPROVAL_EXPIRED' },
  })
  return { expired: abandonedGeneration.count + unread.count }
}

/// Hand the approved illustration to the client.
///
/// Takes proof of approval rather than an id, so there is no signature a caller
/// could use to deliver something unapproved. The transport is injected because
/// nothing in this module decides how a client is reached; sending stays with
/// the messaging module and its own consent and quiet-hour rules.
export async function deliverApprovedIllustration(
  approved: ApprovedIllustration,
  send: (envelope: IllustrationDeliveryEnvelope) => Promise<void>,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: DeliveryRefusal }> {
  // Claim the delivery under the same predicate the approval wrote, because the
  // approval value only proves the agent released it once — not that it is
  // still released now.
  const claimed = await prisma.kBotIllustrationRequest.updateMany({
    where: { id: approved.requestId, agentId: approved.agentId, status: APPROVED },
    data: { status: DELIVERING },
  })
  if (claimed.count === 0) return { ok: false, reason: 'NOT_APPROVED' }

  const illustration = await prisma.illustration.findFirst({
    where: { id: approved.illustrationId, agentId: approved.agentId },
    select: { id: true, productName: true, faceAmount: true, targetPremium: true, documentUrl: true },
  })
  if (!illustration) {
    await releaseClaim(approved, 'ILLUSTRATION_MISSING')
    return { ok: false, reason: 'ILLUSTRATION_MISSING' }
  }

  try {
    await send({
      requestId: approved.requestId,
      agentId: approved.agentId,
      clientId: approved.clientId,
      illustrationId: illustration.id,
      productName: illustration.productName,
      faceAmount: illustration.faceAmount?.toString() ?? null,
      targetPremium: illustration.targetPremium?.toString() ?? null,
      documentUrl: illustration.documentUrl,
    })
  } catch (error) {
    console.error('KBOT_ILLUSTRATION_DELIVERY_FAILED', {
      errorName: error instanceof Error ? error.name : typeof error,
    })
    await releaseClaim(approved, 'TRANSPORT_FAILED')
    return { ok: false, reason: 'TRANSPORT_FAILED' }
  }

  await prisma.kBotIllustrationRequest.updateMany({
    where: { id: approved.requestId, agentId: approved.agentId, status: DELIVERING },
    data: { status: DELIVERED, deliveredAt: now, closedAt: now },
  })
  return { ok: true }
}

/// Hand the claim back so a failed delivery can be retried by the agent, rather
/// than leaving the request stuck mid-flight.
async function releaseClaim(approved: ApprovedIllustration, safeErrorCode: string): Promise<void> {
  await prisma.kBotIllustrationRequest.updateMany({
    where: { id: approved.requestId, agentId: approved.agentId, status: DELIVERING },
    data: { status: APPROVED, safeErrorCode },
  })
}
