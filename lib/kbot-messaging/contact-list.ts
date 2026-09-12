/// A lista de contatos da central, com o único dado que o agente precisa ver
/// por linha: se o K-Bot pode cuidar desta pessoa, e quando não pode, por quê.
///
/// A preferência pode estar gravada sob o id do contato ou sob o próprio
/// número: um pedido de parada chega por telefone, não por id de cliente.

export type KBotContactState = 'ON' | 'OFF' | 'NO_PHONE' | 'STOPPED'

export type KBotContactRow = {
  id: string
  name: string
  phone: string | null
  state: KBotContactState
}

export function toKBotContactRows(input: {
  contacts: ReadonlyArray<{ id: string; name: string; phone: string | null }>
  preferences: ReadonlyArray<{ subjectKey: string; optedOut: boolean; kbotEnabledAt: Date | null }>
}): KBotContactRow[] {
  const byKey = new Map(input.preferences.map((preference) => [preference.subjectKey, preference]))
  return input.contacts.map((contact) => {
    const matches = [byKey.get(contact.id), contact.phone ? byKey.get(contact.phone) : undefined]
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
    // O pedido do cliente é a primeira pergunta, sempre.
    if (matches.some((preference) => preference.optedOut)) {
      return { id: contact.id, name: contact.name, phone: contact.phone, state: 'STOPPED' as const }
    }
    if (!contact.phone) {
      return { id: contact.id, name: contact.name, phone: null, state: 'NO_PHONE' as const }
    }
    const enabled = matches.some((preference) => preference.kbotEnabledAt)
    return {
      id: contact.id, name: contact.name, phone: contact.phone,
      state: enabled ? ('ON' as const) : ('OFF' as const),
    }
  })
}
