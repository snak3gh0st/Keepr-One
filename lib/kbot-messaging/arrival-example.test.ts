import { describe, expect, it } from 'vitest'
import { toArrivalExample } from './arrival-example'

const now = new Date('2026-09-12T12:00:00.000Z')

describe('toArrivalExample', () => {
  it('monta o exemplo com o contato real mais próximo do aniversário', () => {
    const example = toArrivalExample({
      now,
      templateBody: '{{nome}}, feliz aniversário! Que seu ano seja ótimo, com carinho de {{agente}}.',
      agentName: 'Marina Alves',
      candidates: [
        { name: 'Ana Souza', dateOfBirth: new Date('1980-09-18T00:00:00.000Z') },
        { name: 'Bruno Lima', dateOfBirth: new Date('1975-11-02T00:00:00.000Z') },
      ],
    })

    expect(example).toEqual({
      name: 'Ana Souza',
      when: '18/09',
      text: 'Ana Souza, feliz aniversário! Que seu ano seja ótimo, com carinho de Marina Alves.',
    })
  })

  it('devolve nulo sem candidato com data — melhor nada que um exemplo inventado', () => {
    expect(toArrivalExample({ now, templateBody: '{{nome}}, parabéns!', agentName: 'Marina', candidates: [] })).toBeNull()
  })

  it('não chama modelo nenhum: o texto sai do modelo aprovado, com a sintaxe real de placeholder', () => {
    const example = toArrivalExample({
      now,
      templateBody: 'Oi {{nome}}!',
      agentName: 'Marina',
      candidates: [{ name: 'Ana', dateOfBirth: new Date('1990-09-20T00:00:00.000Z') }],
    })

    expect(example!.text).toBe('Oi Ana!')
  })

  it('devolve nulo quando o modelo não é renderizável — chaves cruas nunca chegam ao exemplo', () => {
    const example = toArrivalExample({
      now,
      templateBody: 'Oi {{nome_do_cliente}}!',
      agentName: 'Marina',
      candidates: [{ name: 'Ana', dateOfBirth: new Date('1990-09-20T00:00:00.000Z') }],
    })

    expect(example).toBeNull()
  })

  it('com calendário honesto: late December com aniversários em 02/01 e 20/12', () => {
    // A chegada aparece no fim do ano: contatos com aniversário em janeiro
    // estão mais pertos do que contatos com aniversário em dezembro que já
    // passou. A aproximação (mês * 31) pode ser off por até 7-10 dias neste
    // caso; a implementação honesta usa datas reais do calendário.
    const lateDecember = new Date('2026-12-31T12:00:00.000Z')
    const example = toArrivalExample({
      now: lateDecember,
      templateBody: '{{nome}}, feliz aniversário!',
      agentName: 'Marina',
      candidates: [
        { name: 'João Silva', dateOfBirth: new Date('1990-12-20T00:00:00.000Z') },
        { name: 'Maria Santos', dateOfBirth: new Date('1995-01-02T00:00:00.000Z') },
      ],
    })

    // Jan 2 (próximo ano) está apenas 2 dias away; Dec 20 (já passou) está 354 dias
    // até o próximo — Maria deve ser escolhida mesmo com ambas no mesmo intervalo
    // de mês na aproximação do plano que foi rejeitada.
    expect(example!.name).toBe('Maria Santos')
    expect(example!.when).toBe('02/01')
  })
})
