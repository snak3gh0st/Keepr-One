import 'server-only'

import { messagingTransport } from '@/lib/kbot-followup/transport'
import type { IllustrationDeliveryEnvelope } from './domain'

/// Putting the quote in the client's WhatsApp thread.
///
/// The same transport the follow-up path uses, so the message lands in the
/// conversation the agent already has with this person rather than starting a
/// parallel one.

const currency = (value: string | null, language: string): string | null => {
  if (value === null) return null
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  return new Intl.NumberFormat(language === 'EN' ? 'en-US' : 'pt-BR', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(amount)
}

/// The text that goes with the document.
///
/// Facts only, in the order the client asked about them: what product, how much
/// cover, what it costs. No persuasion — the agent's own words are what sell,
/// and a bot writing sales copy over their name is exactly what nobody asked
/// for. Exported for testing, and because the wording is worth reading on its
/// own.
export function illustrationMessage(
  envelope: IllustrationDeliveryEnvelope,
  language: string = envelope.language,
): string {
  const pt = language !== 'EN'
  const lines: string[] = []
  lines.push(pt
    ? `${envelope.clientName.split(/\s+/)[0]}, aqui está a simulação que você pediu.`
    : `${envelope.clientName.split(/\s+/)[0]}, here is the illustration you asked for.`)
  if (envelope.productName) lines.push(pt ? `Produto: ${envelope.productName}` : `Product: ${envelope.productName}`)
  const face = currency(envelope.faceAmount, language)
  if (face) lines.push(pt ? `Cobertura: ${face}` : `Coverage: ${face}`)
  const premium = currency(envelope.targetPremium, language)
  if (premium) lines.push(pt ? `Prêmio: ${premium}` : `Premium: ${premium}`)
  if (envelope.documentUrl) lines.push(envelope.documentUrl)
  return lines.join('\n')
}

export async function sendIllustrationToClient(envelope: IllustrationDeliveryEnvelope): Promise<void> {
  const transport = await messagingTransport(envelope.agentId)
  const conversationId = await transport.conversation(envelope.phone, envelope.clientName)
  await transport.verifyConversation(conversationId, envelope.phone)
  await transport.send(
    conversationId,
    illustrationMessage(envelope, envelope.language),
    envelope.requestId,
    envelope.phone,
  )
}
