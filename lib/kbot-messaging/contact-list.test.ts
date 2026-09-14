import { describe, expect, it } from 'vitest'
import { toKBotContactRows } from './contact-list'
import { subjectKeyForClient } from './subject-key'

const now = new Date('2026-09-12T15:00:00.000Z')

describe('toKBotContactRows', () => {
  it('classifica cada contato pelo que decide se ele pode receber', () => {
    const rows = toKBotContactRows({
      contacts: [
        { id: 'c1', name: 'Ana Souza', phone: '+5511999990001' },
        { id: 'c2', name: 'Bruno Lima', phone: null },
        { id: 'c3', name: 'Carla Dias', phone: '+5511999990003' },
        { id: 'c4', name: 'Davi Melo', phone: '+5511999990004' },
      ],
      preferences: [
        { subjectKey: subjectKeyForClient('c1'), optedOut: false, kbotEnabledAt: now },
        { subjectKey: subjectKeyForClient('c3'), optedOut: true, kbotEnabledAt: now },
      ],
    })

    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ['Ana Souza', 'ON'],
      ['Bruno Lima', 'NO_PHONE'],
      // Pediu para parar: vence a habilitação, e a tela não oferece interruptor.
      ['Carla Dias', 'STOPPED'],
      ['Davi Melo', 'OFF'],
    ])
  })

  it('casa preferência gravada pelo telefone, não só pelo id', () => {
    const rows = toKBotContactRows({
      contacts: [{ id: 'c1', name: 'Ana', phone: '+5511999990001' }],
      preferences: [{ subjectKey: '+5511999990001', optedOut: true, kbotEnabledAt: null }],
    })

    expect(rows[0]!.state).toBe('STOPPED')
  })

  it('casa o telefone formatado com o opt-out normalizado', () => {
    const rows = toKBotContactRows({
      contacts: [{ id: 'c1', name: 'Ana', phone: '+55 (11) 99999-0001' }],
      preferences: [{ subjectKey: '+5511999990001', optedOut: true, kbotEnabledAt: null }],
    })

    expect(rows[0]!.state).toBe('STOPPED')
  })

  // A linha é onde o agente age, então ela diz o que fazer: um número sem
  // código de país pede quatro caracteres, não um telefone novo.
  it('distingue sem telefone, sem código de país e número inválido', () => {
    const rows = toKBotContactRows({
      contacts: [
        { id: 'c1', name: 'Ana', phone: null },
        { id: 'c2', name: 'Bruno', phone: '(555) 123-4567' },
        { id: 'c3', name: 'Carla', phone: 'liga no escritório' },
      ],
      preferences: [],
    })

    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ['Ana', 'NO_PHONE'],
      ['Bruno', 'COUNTRY_REQUIRED'],
      ['Carla', 'INVALID_PHONE'],
    ])
  })

  // O número continua na linha mesmo quando não serve: é o que o agente
  // precisa ver para corrigi-lo.
  it('preserva o número na ficha mesmo quando não é alcançável', () => {
    const rows = toKBotContactRows({
      contacts: [{ id: 'c1', name: 'Ana', phone: '(555) 123-4567' }],
      preferences: [],
    })

    expect(rows[0]!.phone).toBe('(555) 123-4567')
  })
})
