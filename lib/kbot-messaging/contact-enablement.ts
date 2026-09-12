/// Ligar e desligar o K-Bot por pessoa.
///
/// Duas regras moram aqui e não em nenhum chamador: gravar habilitação nunca
/// toca no pedido do cliente, e a ação em massa não inclui quem pediu para
/// parar. A segunda é redundante com o gate de propósito — o gate barra de todo
/// jeito, e a contagem que o agente vê antes de confirmar precisa ser honesta.

export type ContactEnablementDb = {
  client: {
    findMany(args: unknown): Promise<Array<{ id: string; phone: string | null }>>
  }
  kBotContactPreference: {
    findMany(args: unknown): Promise<Array<{ subjectKey: string; optedOut: boolean }>>
    upsert(args: unknown): Promise<unknown>
  }
}

export async function setContactEnabled(
  db: ContactEnablementDb,
  input: { agentId: string; subjectKey: string; enabled: boolean; now: Date },
): Promise<{ enabled: boolean }> {
  const kbotEnabledAt = input.enabled ? input.now : null
  await db.kBotContactPreference.upsert({
    where: { agentId_subjectKey: { agentId: input.agentId, subjectKey: input.subjectKey } },
    create: { agentId: input.agentId, subjectKey: input.subjectKey, kbotEnabledAt },
    update: { kbotEnabledAt },
  })
  return { enabled: input.enabled }
}

export async function enableAllAgentContacts(
  db: ContactEnablementDb,
  input: { agentId: string; now: Date },
): Promise<{ enabled: number; withoutPhone: number; optedOut: number }> {
  const contacts = await db.client.findMany({
    where: { assignedAgentId: input.agentId },
    select: { id: true, phone: true },
  })
  const stopped = new Set(
    (await db.kBotContactPreference.findMany({
      where: { agentId: input.agentId, optedOut: true },
      select: { subjectKey: true, optedOut: true },
    })).map((preference) => preference.subjectKey),
  )

  let enabled = 0
  let withoutPhone = 0
  let optedOut = 0
  for (const contact of contacts) {
    if (!contact.phone) { withoutPhone += 1; continue }
    if (stopped.has(contact.id) || stopped.has(contact.phone)) { optedOut += 1; continue }
    await setContactEnabled(db, {
      agentId: input.agentId, subjectKey: contact.id, enabled: true, now: input.now,
    })
    enabled += 1
  }
  return { enabled, withoutPhone, optedOut }
}
