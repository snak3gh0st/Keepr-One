'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { setContactEnabled, enableAllAgentContacts } from '@/lib/kbot-messaging/contact-enablement'

/// As ações de habilitação do K-Bot dentro da Central de Mensagens — mesmo
/// formato de `app/agent/kbot/agendadas/actions.ts`: origem verificada, agente
/// resolvido da sessão (nunca do corpo da requisição), e a página revalidada
/// depois de escrever. O gate de envio continua sendo o único ponto de
/// decisão; estas ações apenas ligam ou desligam quem pode ser alcançado.

export type KBotContactActionResult =
  | { ok: true }
  | { ok: false; message: string }

export type KBotEnableAllResult =
  | { ok: true; enabled: number; withoutPhone: number; optedOut: number }
  | { ok: false; message: string }

const PATH = '/agent/mensagens'

const toggleSchema = z.strictObject({
  clientId: z.string().min(1).max(64),
  enabled: z.boolean(),
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

const unavailable = (copy: (pt: string, en: string) => string) =>
  copy(
    'Não foi possível salvar agora. Tente novamente.',
    'We could not save this right now. Please try again.',
  )

/// Liga ou desliga o K-Bot para um único contato.
export async function toggleKBotContact(input: unknown): Promise<KBotContactActionResult> {
  const { copy } = await getServerI18n()
  const parsed = toggleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  try {
    const agent = await currentAgent()
    // O alvo tem de pertencer à carteira deste agente. `agentId` vem da
    // sessão e a chave é única por agente, então não há escrita cruzando
    // agentes de todo jeito — mas sem esta checagem um `clientId` forjado de
    // fora da carteira ainda plantaria uma preferência visível ao gate para
    // alguém que este agente nunca deveria poder tocar.
    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, assignedAgentId: agent.id },
      select: { id: true },
    })
    if (!client) return { ok: false, message: unavailable(copy) }
    await setContactEnabled(prisma, {
      agentId: agent.id,
      clientId: client.id,
      enabled: parsed.data.enabled,
      now: new Date(),
    })
    revalidatePath(PATH)
    return { ok: true }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}

/// Liga o K-Bot para todos os contatos deste agente que podem receber —
/// pulando quem não tem telefone e quem já pediu para não receber. A
/// contagem honesta que este retorno carrega é o que a tela mostra depois do
/// clique, em vez de fingir que "todos" significa literalmente todos.
export async function enableAllKBotContacts(input: unknown): Promise<KBotEnableAllResult> {
  const { copy } = await getServerI18n()
  const parsed = z.strictObject({}).safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  try {
    const agent = await currentAgent()
    const result = await enableAllAgentContacts(prisma, { agentId: agent.id, now: new Date() })
    revalidatePath(PATH)
    return { ok: true, ...result }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}
