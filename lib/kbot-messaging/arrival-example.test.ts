import { describe, expect, it } from 'vitest'
import { toArrivalExample } from './arrival-example'

const now = new Date('2026-09-12T12:00:00.000Z')

describe('toArrivalExample', () => {
  it('monta o exemplo com o contato real mais próximo do aniversário', () => {
    const example = toArrivalExample({
      now,
      templateBody: '{nome}, feliz aniversário! Que seu ano seja ótimo.',
      candidates: [
        { name: 'Ana Souza', dateOfBirth: new Date('1980-09-18T00:00:00.000Z') },
        { name: 'Bruno Lima', dateOfBirth: new Date('1975-11-02T00:00:00.000Z') },
      ],
    })

    expect(example).toEqual({
      name: 'Ana Souza',
      when: '18/09',
      text: 'Ana Souza, feliz aniversário! Que seu ano seja ótimo.',
    })
  })

  it('devolve nulo sem candidato com data — melhor nada que um exemplo inventado', () => {
    expect(toArrivalExample({ now, templateBody: '{nome}, parabéns!', candidates: [] })).toBeNull()
  })

  it('não chama modelo nenhum: o texto sai do modelo aprovado', () => {
    const example = toArrivalExample({
      now,
      templateBody: 'Oi {nome}!',
      candidates: [{ name: 'Ana', dateOfBirth: new Date('1990-09-20T00:00:00.000Z') }],
    })

    expect(example!.text).toBe('Oi Ana!')
  })
})
