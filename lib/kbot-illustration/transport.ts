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
/// Written as a sentence, not a form. The client is reading a message from
/// their agent, and "Produto: FlexLife / Cobertura: US$ 250.000" reads like a
/// system printout — which is exactly what it must not feel like, because the
/// agent is the one whose name is on it.
///
/// Facts only, still: what it is, how much cover, what it costs a month. No
/// adjectives and no closing push. A figure the carrier did not return is a
/// clause that is not there, never `null` or `$0` in somebody's chat, and the
/// sentence has to read properly with any combination of them missing.
export function illustrationMessage(
  envelope: IllustrationDeliveryEnvelope,
  language: string = envelope.language,
): string {
  const pt = language !== 'EN'
  const firstName = envelope.clientName.trim().split(/\s+/)[0] ?? envelope.clientName
  // The carrier's own number first; the requested target is only a fallback.
  const cover = currency(envelope.faceAmount, language)
  const monthly = currency(envelope.premium ?? envelope.targetPremium, language)
  const product = envelope.productName?.trim() || null

  const opening = pt
    ? `${firstName}, aqui está a simulação que você pediu.`
    : `${firstName}, here is the illustration you asked for.`

  const clauses: string[] = []
  if (product) clauses.push(pt ? `É um ${product}` : `It is a ${product}`)
  if (cover) {
    clauses.push(clauses.length
      ? (pt ? `com ${cover} de cobertura` : `with ${cover} in coverage`)
      : (pt ? `São ${cover} de cobertura` : `It covers ${cover}`))
  }
  if (monthly) {
    clauses.push(clauses.length
      ? (pt ? `por ${monthly} por mês` : `at ${monthly} a month`)
      : (pt ? `Fica em ${monthly} por mês` : `It comes to ${monthly} a month`))
  }
  const detail = clauses.length ? `${clauses.join(pt ? ', ' : ', ')}.` : null

  const closing = pt
    ? 'O PDF completo está em anexo. Qualquer dúvida, é só me chamar.'
    : 'The full PDF is attached. Any questions, just message me.'

  return [opening, detail, closing].filter((part): part is string => part !== null).join(' ')
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
