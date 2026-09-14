/// Por que o K-Bot pode ou não falar com uma pessoa — uma pergunta, uma
/// resposta, um lugar.
///
/// Três telas faziam essa conta por conta própria e chegavam a respostas
/// diferentes: a contagem da chegada perguntava ao banco se o campo era nulo,
/// a ação em massa perguntava se `normalizePhone` devolvia algo, e a lista
/// perguntava a mesma coisa mas chamava tudo de "sem telefone". Um número
/// gravado como `(555) 123-4567` era, ao mesmo tempo, telefone cadastrado para
/// a primeira e contato sem telefone para as outras duas — e o agente via os
/// dois números sem nenhum jeito de reconciliá-los.
///
/// A distinção que importa para quem usa: um contato sem telefone precisa de
/// um telefone, e um contato com telefone sem código de país precisa de quatro
/// caracteres. Chamar os dois de "sem telefone" esconde a correção mais barata
/// que o agente poderia fazer.
import { phoneIssue } from '@/lib/kbot-followup/contact-quality'
import { normalizePhone } from '@/lib/kbot-followup/domain'

export type ContactReachIssue = 'MISSING' | 'COUNTRY_REQUIRED' | 'INVALID'

export type ContactReach =
  | { ok: true; phone: string }
  | { ok: false; issue: ContactReachIssue }

/// A mesma regra que o gate de envio aplica em `scheduled-queue.ts`, dita uma
/// vez. Um contato só é alcançável se `normalizePhone` o aceita; o resto é o
/// motivo pelo qual não é.
export function contactReach(phone: string | null | undefined): ContactReach {
  const issue = phoneIssue(phone)
  if (issue !== null) return { ok: false, issue }
  // `phoneIssue` acabou de aprovar: `normalizePhone` não tem como recusar.
  return { ok: true, phone: normalizePhone(phone)! }
}

export type ContactReachTally = {
  total: number
  reachable: number
  missingPhone: number
  countryRequired: number
  invalidPhone: number
}

/// A população vazia, para quando a varredura não vale a pena. Nomeada aqui
/// para que o formato do balde vazio não seja reinventado por quem a pula.
export const NO_CONTACT_REACH: ContactReachTally = {
  total: 0, reachable: 0, missingPhone: 0, countryRequired: 0, invalidPhone: 0,
}

/// Conta uma população inteira pelos quatro estados. O total sempre fecha:
/// cada contato cai em exatamente um balde.
export function tallyContactReach(phones: ReadonlyArray<string | null>): ContactReachTally {
  const tally: ContactReachTally = { ...NO_CONTACT_REACH, total: phones.length }
  for (const phone of phones) {
    const reach = contactReach(phone)
    if (reach.ok) tally.reachable += 1
    else if (reach.issue === 'MISSING') tally.missingPhone += 1
    else if (reach.issue === 'COUNTRY_REQUIRED') tally.countryRequired += 1
    else tally.invalidPhone += 1
  }
  return tally
}
