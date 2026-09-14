/// Ligar e desligar o K-Bot por pessoa.
///
/// Duas regras moram aqui e não em nenhum chamador: gravar habilitação nunca
/// toca no pedido do cliente, e a ação em massa não inclui quem pediu para
/// parar. A segunda é redundante com o gate de propósito — o gate barra de todo
/// jeito, e a contagem que o agente vê antes de confirmar precisa ser honesta.
///
/// A chave de assunto é sempre `client:<id>` — a mesma forma que
/// `scheduled-triggers.ts` cunha e que o gate (`scheduled-queue.ts`,
/// `scheduled-worker.ts`, `kbot-illustration/delivery.ts`) lê. Escrever a
/// chave errada aqui deixaria a habilitação muda: o agente veria "Ligado" mas
/// o gate nunca encontraria a preferência.
import { subjectKeyForClient } from './subject-key'
import { contactReach } from './contact-reach'

/// Os cinco destinos possíveis de um contato na ação em massa. Somados, dão a
/// população inteira do agente — é isso que deixa a tela antes do clique e o
/// aviso depois dele reconciliarem.
export type EnableAllTally = {
  enabled: number
  missingPhone: number
  countryRequired: number
  invalidPhone: number
  optedOut: number
}

export type ContactEnablementDb = {
  client: {
    findMany(args: unknown): Promise<Array<{ id: string; phone: string | null }>>
  }
  kBotContactPreference: {
    findMany(args: unknown): Promise<Array<{ subjectKey: string; optedOut: boolean }>>
    upsert(args: unknown): Promise<unknown>
    updateMany(args: unknown): Promise<unknown>
    createMany(args: unknown): Promise<unknown>
  }
}

export async function setContactEnabled(
  db: ContactEnablementDb,
  input: { agentId: string; clientId: string; enabled: boolean; now: Date },
): Promise<{ enabled: boolean }> {
  const subjectKey = subjectKeyForClient(input.clientId)
  const kbotEnabledAt = input.enabled ? input.now : null
  await db.kBotContactPreference.upsert({
    where: { agentId_subjectKey: { agentId: input.agentId, subjectKey } },
    create: { agentId: input.agentId, subjectKey, kbotEnabledAt },
    update: { kbotEnabledAt },
  })
  return { enabled: input.enabled }
}

export async function enableAllAgentContacts(
  db: ContactEnablementDb,
  input: { agentId: string; now: Date },
): Promise<EnableAllTally> {
  // Lê todos os contatos e preferências uma única vez.
  const contacts = await db.client.findMany({
    where: { assignedAgentId: input.agentId },
    select: { id: true, phone: true },
  })
  const preferences = await db.kBotContactPreference.findMany({
    where: { agentId: input.agentId },
    select: { subjectKey: true, optedOut: true },
  })

  // Separa quem pediu para parar e quem já tem preferência.
  const stopped = new Set<string>()
  const existing = new Set<string>()
  for (const pref of preferences) {
    if (pref.optedOut) {
      stopped.add(pref.subjectKey)
    }
    existing.add(pref.subjectKey)
  }

  // Processa cada contato e agrupa para batch operations.
  let enabled = 0
  let missingPhone = 0
  let countryRequired = 0
  let invalidPhone = 0
  let optedOut = 0
  const toCreate: string[] = []
  const toUpdate: string[] = []

  for (const contact of contacts) {
    // Quem ficou de fora fica de fora por um motivo nomeado: "sem telefone"
    // dito sobre um número que só não tem código de país esconde do agente a
    // correção de quatro caracteres que traria essa pessoa de volta.
    const reach = contactReach(contact.phone)
    if (!reach.ok) {
      if (reach.issue === 'MISSING') missingPhone += 1
      else if (reach.issue === 'COUNTRY_REQUIRED') countryRequired += 1
      else invalidPhone += 1
      continue
    }
    const subjectKey = subjectKeyForClient(contact.id)
    if (stopped.has(subjectKey) || stopped.has(reach.phone)) { optedOut += 1; continue }

    if (existing.has(subjectKey)) {
      toUpdate.push(subjectKey)
    } else {
      toCreate.push(subjectKey)
    }
    enabled += 1
  }

  // Chunk em lotes de 1000 para não sobrecarregar uma única query.
  const CHUNK_SIZE = 1000
  for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
    const chunk = toUpdate.slice(i, i + CHUNK_SIZE)
    await db.kBotContactPreference.updateMany({
      where: { agentId: input.agentId, subjectKey: { in: chunk } },
      data: { kbotEnabledAt: input.now },
    })
  }

  for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + CHUNK_SIZE)
    await db.kBotContactPreference.createMany({
      data: chunk.map((subjectKey) => ({
        agentId: input.agentId,
        subjectKey,
        kbotEnabledAt: input.now,
      })),
      skipDuplicates: true,
    })
  }

  return { enabled, missingPhone, countryRequired, invalidPhone, optedOut }
}
