import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/kbot-followup/domain'
import { READY_TO_SEND, SEND_WINDOW_MS } from '@/lib/kbot-illustration/domain'
import { illustrationMessage } from '@/lib/kbot-illustration/transport'

/// The quotes K-Bot generated and nobody has sent yet.
///
/// Read on the illustrations directory because that is where the agent already
/// is when they look at figures and decide whether the client should see them.
/// Everything here is what the send would use, not a second description of it:
/// the caption comes out of `illustrationMessage`, the same function
/// `sendIllustrationToClient` calls, so the agent reads the message that leaves.

export type ReadyToSendIllustration = {
  requestId: string
  clientName: string
  productName: string | null
  /// Already formatted for the agent's language, so the card and the caption
  /// cannot disagree about what a figure looks like.
  faceAmount: string | null
  targetPremium: string | null
  /// The exact text that travels with the PDF.
  message: string
  /// Whether the carrier document is actually in Keeprone. Without it the send
  /// fails at the transport, and the agent deserves to know before pressing.
  hasDocument: boolean
  /// Whether the client has a number the transport can dial.
  reachable: boolean
  createdAt: string
  /// When the numbers stop being sendable. Rendered as a countdown, so it is
  /// sent as an instant rather than as a phrase computed on the server.
  expiresAt: string
}

const currency = (value: unknown, language: string): string | null => {
  if (value === null || value === undefined) return null
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  return new Intl.NumberFormat(language === 'EN' ? 'en-US' : 'pt-BR', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(amount)
}

export async function readReadyToSendIllustrations(
  agentId: string,
  now: Date = new Date(),
): Promise<ReadyToSendIllustration[]> {
  // The same predicate the delivery claim re-checks. `expireStaleIllustration-
  // Requests` is a sweeper, so rows sit past the window until it runs; without
  // the window here the screen would offer send buttons that are guaranteed to
  // come back as NOT_READY_TO_SEND.
  const [requests, agent] = await Promise.all([
    prisma.kBotIllustrationRequest.findMany({
      where: {
        agentId,
        status: READY_TO_SEND,
        createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) },
        // The delivery looks the client up as `assignedAgentId: agentId`, so a
        // client reassigned since the quote was raised is refused there as
        // CLIENT_UNREACHABLE — which would be read as "no phone number" and be
        // untrue. Matching the predicate keeps the list honest.
        client: { assignedAgentId: agentId },
      },
      // Oldest first: those are the ones closest to expiring, and expiry is the
      // only thing on this list that happens without the agent.
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        client: { select: { id: true, name: true, phone: true } },
        illustration: {
          select: {
            id: true, productName: true, faceAmount: true, targetPremium: true,
            // Never `documentBytes`: ~1.5 MB a row would travel into the page
            // payload to answer a yes-or-no question these two already answer.
            documentUrl: true, documentFetchedAt: true, documentMimeType: true,
          },
        },
      },
    }),
    // The language the delivery itself uses — the agent's own, not the UI
    // locale of whoever is looking. Reading it from anywhere else would show a
    // preview in one language and send the message in another.
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { user: { select: { language: true } } },
    }),
  ])
  const language = agent?.user.language ?? 'PT'

  return requests.flatMap((request) => {
    // Ready without an illustration is not a state the connector produces, and
    // there would be no figures to show. Left out rather than rendered empty.
    if (!request.illustration) return []
    const phone = normalizePhone(request.client.phone)
    const envelope = {
      requestId: request.id,
      agentId,
      clientId: request.client.id,
      clientName: request.client.name,
      phone: phone ?? '',
      language,
      illustrationId: request.illustration.id,
      productName: request.illustration.productName,
      faceAmount: request.illustration.faceAmount?.toString() ?? null,
      targetPremium: request.illustration.targetPremium?.toString() ?? null,
      documentUrl: request.illustration.documentUrl,
    }
    return [{
      requestId: request.id,
      clientName: request.client.name,
      productName: request.illustration.productName,
      faceAmount: currency(request.illustration.faceAmount, language),
      targetPremium: currency(request.illustration.targetPremium, language),
      message: illustrationMessage(envelope),
      hasDocument: Boolean(request.illustration.documentFetchedAt && request.illustration.documentMimeType),
      reachable: phone !== null,
      createdAt: request.createdAt.toISOString(),
      expiresAt: new Date(request.createdAt.getTime() + SEND_WINDOW_MS).toISOString(),
    }]
  })
}
