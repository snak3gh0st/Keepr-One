import { describe, expect, it } from 'vitest'
import { contactReach, tallyContactReach } from './contact-reach'

describe('contactReach separa os motivos de não alcançar', () => {
  it('aceita o número em formato internacional e o normaliza', () => {
    expect(contactReach('+55 (11) 99999-9999')).toEqual({ ok: true, phone: '+5511999999999' })
  })

  it('distingue ausente de sem código de país', () => {
    expect(contactReach(null)).toEqual({ ok: false, issue: 'MISSING' })
    expect(contactReach('   ')).toEqual({ ok: false, issue: 'MISSING' })
    // O caso que a mensagem "sem telefone" escondia: há telefone, falta o país.
    expect(contactReach('(555) 123-4567')).toEqual({ ok: false, issue: 'COUNTRY_REQUIRED' })
  })

  it('chama de inválido o que não é telefone', () => {
    expect(contactReach('liga no escritório')).toEqual({ ok: false, issue: 'INVALID' })
    expect(contactReach('+1')).toEqual({ ok: false, issue: 'INVALID' })
  })
})

describe('tallyContactReach', () => {
  it('fecha a conta: cada contato cai em exatamente um balde', () => {
    const phones = [null, '   ', '(555) 123-4567', '+5511999999999', '+1 415 555 2671', 'sem telefone mesmo']

    const tally = tallyContactReach(phones)

    expect(tally).toEqual({ total: 6, reachable: 2, missingPhone: 2, countryRequired: 1, invalidPhone: 1 })
    expect(tally.reachable + tally.missingPhone + tally.countryRequired + tally.invalidPhone).toBe(tally.total)
  })
})
