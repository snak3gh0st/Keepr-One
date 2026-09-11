'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { getServerI18n } from '@/lib/i18n/server'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { type DeliveryRefusal } from '@/lib/kbot-illustration/domain'
import { discardIllustrationRequest } from '@/lib/kbot-illustration/delivery'
import { sendIllustrationRequest } from '@/lib/kbot-illustration/delivery'
import { sendIllustrationToClient } from '@/lib/kbot-illustration/transport'

/// Sending a generated quote, and dropping one.
///
/// Generating happens inside Keeprone and needs nobody; putting the PDF in
/// someone's WhatsApp is the half that waits for the agent, and this is that
/// half. The agent id comes from the session on every path — the screen sends
/// only a request id, so a stale or forged screen cannot reach into another
/// agent's book. `sendIllustrationRequest` filters on `agentId` a second time.

export type ReadyToSendActionResult =
  | { ok: true }
  /// `reason` travels so the screen can tell the client's own instruction
  /// apart from something that went wrong. `message` is the sentence.
  | { ok: false; reason: DeliveryRefusal | 'UNAVAILABLE'; message: string }

const PATH = '/agent/illustrations'

const requestSchema = z.strictObject({
  requestId: z.string().min(1).max(64),
})

async function currentAgent() {
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  return getCurrentAgent()
}

const unavailable = (copy: (pt: string, en: string) => string): ReadyToSendActionResult => ({
  ok: false,
  reason: 'UNAVAILABLE',
  message: copy(
    'Não foi possível fazer isso agora. Tente novamente.',
    'We could not do this right now. Please try again.',
  ),
})

/// Why the quote did not reach the client, said as the fact rather than as a
/// code. None of these invite pressing the same button again: a refused request
/// is closed, so what is offered is the thing that would actually help.
function refusalMessage(
  reason: DeliveryRefusal,
  copy: (pt: string, en: string) => string,
): string {
  switch (reason) {
    case 'NOT_READY_TO_SEND':
      return copy(
        'Esta cotação não está mais disponível para envio — ou alguém já mandou, ou passaram os três dias em que os números valem. Gere uma nova para este cliente.',
        'This quote can no longer be sent — either it has already gone out, or the three days these figures are good for have passed. Generate a new one for this client.',
      )
    case 'OPTED_OUT':
      // Not a failure and not the agent's mistake: the client asked not to be
      // contacted, and that instruction outranks the click.
      return copy(
        'O cliente pediu para não receber mensagens, então nada foi enviado. Essa é a instrução dele — se ele mudar de ideia, reative o contato nas mensagens agendadas.',
        'This client asked not to be contacted, so nothing was sent. That is their own instruction — if they change their mind, restore the contact in scheduled messages.',
      )
    case 'CLIENT_UNREACHABLE':
      return copy(
        'Este cliente não tem um número de WhatsApp no cadastro, então não havia para onde mandar. Cadastre o telefone e gere a cotação de novo.',
        'This client has no WhatsApp number on file, so there was nowhere to send it. Add the phone number and generate the quote again.',
      )
    case 'ILLUSTRATION_MISSING':
      return copy(
        'A ilustração desta cotação não está mais no Keeprone, e uma mensagem sem o PDF não seria a cotação. Gere uma nova para este cliente.',
        'The illustration behind this quote is no longer in Keeprone, and a message without the PDF would not be the quote. Generate a new one for this client.',
      )
    case 'TRANSPORT_FAILED':
      return copy(
        'O WhatsApp não aceitou a mensagem: a conexão pode estar caída ou o provedor fora do ar. Confira a conexão e gere a cotação de novo.',
        'WhatsApp did not accept the message: the connection may be down or the provider unavailable. Check the connection and generate the quote again.',
      )
  }
}

/// The agent read the numbers and chose to put them in the client's WhatsApp.
///
/// `sendIllustrationToClient` is the only transport — the PDF and the caption
/// go in one bubble, and the caption is the same `illustrationMessage` the
/// screen showed before the click.
export async function sendReadyIllustration(input: unknown): Promise<ReadyToSendActionResult> {
  const { copy } = await getServerI18n()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return unavailable(copy)
  try {
    const agent = await currentAgent()
    const result = await sendIllustrationRequest(
      { agentId: agent.id, requestId: parsed.data.requestId },
      sendIllustrationToClient,
    )
    // Refusals close the request too, so the row has to leave the list either
    // way — otherwise the screen keeps offering a send that can never succeed.
    revalidatePath(PATH)
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason, message: refusalMessage(result.reason, copy) }
  } catch {
    return unavailable(copy)
  }
}

/// The agent read the numbers and chose not to send them.
///
/// The guard lives in `discardIllustrationRequest`, next to the send claim that
/// decides the same row: a predicate written in two places is a predicate that
/// drifts, and this one is what stops a discard from overwriting a delivery.
export async function discardReadyIllustration(input: unknown): Promise<ReadyToSendActionResult> {
  const { copy } = await getServerI18n()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return unavailable(copy)
  try {
    const agent = await currentAgent()
    const closed = await discardIllustrationRequest({ agentId: agent.id, requestId: parsed.data.requestId })
    revalidatePath(PATH)
    if (closed.discarded === 0) {
      return { ok: false, reason: 'NOT_READY_TO_SEND', message: refusalMessage('NOT_READY_TO_SEND', copy) }
    }
    return { ok: true }
  } catch {
    return unavailable(copy)
  }
}
