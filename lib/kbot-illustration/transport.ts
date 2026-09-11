import 'server-only'

import { prisma } from '@/lib/prisma'
import { messagingTransport } from '@/lib/kbot-followup/transport'
import type { IllustrationDeliveryEnvelope } from './domain'

/// Putting the quote in the client's WhatsApp: the PDF and, in the same
/// message, what it says.
///
/// One bubble, not two. The document alone is a file the client has to open to
/// understand; the text alone is figures with nothing behind them. Sending them
/// together is what the agent would do by hand, which is the standard this has
/// to meet — the client cannot tell who pressed the button and should not have
/// to.

const currency = (value: string | null, language: string): string | null => {
  if (value === null) return null
  const amount = Number(value)
  if (!Number.isFinite(amount)) return null
  return new Intl.NumberFormat(language === 'EN' ? 'en-US' : 'pt-BR', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(amount)
}

/// The words that go with the document.
///
/// Facts, in the order the client asked about them: what product, how much
/// cover, what it costs. No persuasion — the agent's own words are what sell,
/// and a bot writing sales copy over their name is not what anyone asked for.
/// A figure the carrier did not return is a line that is not there, never
/// `null` or `$0` in somebody's chat.
export function illustrationMessage(
  envelope: IllustrationDeliveryEnvelope,
  language: string = envelope.language,
): string {
  const pt = language !== 'EN'
  const firstName = envelope.clientName.trim().split(/\s+/)[0] ?? envelope.clientName
  const lines: string[] = []
  lines.push(pt
    ? `${firstName}, aqui está a simulação que você pediu.`
    : `${firstName}, here is the illustration you asked for.`)
  if (envelope.productName) lines.push(pt ? `Produto: ${envelope.productName}` : `Product: ${envelope.productName}`)
  const face = currency(envelope.faceAmount, language)
  if (face) lines.push(pt ? `Cobertura: ${face}` : `Coverage: ${face}`)
  const premium = currency(envelope.targetPremium, language)
  if (premium) lines.push(pt ? `Prêmio: ${premium}` : `Premium: ${premium}`)
  lines.push(pt
    ? 'O PDF completo está anexado. Qualquer dúvida, é só me chamar.'
    : 'The full PDF is attached. Any questions, just message me.')
  return lines.join('\n')
}

/// The filename the client sees when they save it. Their own name and the
/// product, not a cuid — this ends up in someone's downloads folder.
export function documentFileName(envelope: IllustrationDeliveryEnvelope): string {
  const slug = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const parts = [slug(envelope.clientName), envelope.productName ? slug(envelope.productName) : null]
    .filter((part): part is string => !!part)
  return `${parts.join('-') || 'illustration'}.pdf`
}

export class IllustrationTransportError extends Error {
  constructor(public code: 'DOCUMENT_MISSING') {
    super(code)
  }
}

export async function sendIllustrationToClient(envelope: IllustrationDeliveryEnvelope): Promise<void> {
  const illustration = await prisma.illustration.findFirst({
    where: { id: envelope.illustrationId, agentId: envelope.agentId },
    select: { documentBytes: true, documentMimeType: true },
  })
  // No file, no send. A caption describing a PDF that is not attached reads as
  // a broken message, and the agent pressed send expecting the document.
  if (!illustration?.documentBytes) throw new IllustrationTransportError('DOCUMENT_MISSING')

  // The shared transport, so the module gate, the channel state and the sender
  // identity are checked exactly once, in the place that already knows how.
  const transport = await messagingTransport(envelope.agentId)
  await transport.sendDocument({
    phone: envelope.phone,
    media: Buffer.from(illustration.documentBytes).toString('base64'),
    mimeType: illustration.documentMimeType ?? 'application/pdf',
    fileName: documentFileName(envelope),
    caption: illustrationMessage(envelope),
  })
}
