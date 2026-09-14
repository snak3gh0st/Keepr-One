/// A lista de contatos da central, com o único dado que o agente precisa ver
/// por linha: se o K-Bot pode cuidar desta pessoa, e quando não pode, por quê.
///
/// A preferência pode estar gravada sob `client:<id>` (a chave que
/// `subjectKeyForClient` cunha e que o gate de envio lê) ou sob o próprio
/// número: um pedido de parada chega por telefone, não por id de cliente.
import { subjectKeyForClient } from './subject-key'
import { contactReach } from './contact-reach'

/// `NO_PHONE` é só quem não tem telefone nenhum. Um número sem código de país
/// e um número que não é telefone falham pelo mesmo gate, mas pedem coisas
/// diferentes do agente, e a linha é onde ele age.
export type KBotContactState = 'ON' | 'OFF' | 'NO_PHONE' | 'COUNTRY_REQUIRED' | 'INVALID_PHONE' | 'STOPPED'

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
    const reach = contactReach(contact.phone)
    const matches = [byKey.get(subjectKeyForClient(contact.id)), reach.ok ? byKey.get(reach.phone) : undefined]
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
    // O pedido do cliente é a primeira pergunta, sempre.
    if (matches.some((preference) => preference.optedOut)) {
      return { id: contact.id, name: contact.name, phone: contact.phone, state: 'STOPPED' as const }
    }
    if (!reach.ok) {
      const state = reach.issue === 'MISSING'
        ? ('NO_PHONE' as const)
        : reach.issue === 'COUNTRY_REQUIRED'
          ? ('COUNTRY_REQUIRED' as const)
          : ('INVALID_PHONE' as const)
      return { id: contact.id, name: contact.name, phone: contact.phone, state }
    }
    const enabled = matches.some((preference) => preference.kbotEnabledAt)
    return {
      id: contact.id, name: contact.name, phone: contact.phone,
      state: enabled ? ('ON' as const) : ('OFF' as const),
    }
  })
}
