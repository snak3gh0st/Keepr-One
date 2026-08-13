import { describe, expect, it } from 'vitest'
import { DEFAULT_CRM_STAGES } from './constants'

describe('default CRM pipeline', () => {
  it('stores the exact fourteen real stages and keeps Todos virtual', () => {
    expect(DEFAULT_CRM_STAGES).toHaveLength(14)
    expect(DEFAULT_CRM_STAGES.map((stage) => stage.name)).toEqual([
      'Novo Lead', 'Follow-up', 'Em Contato', 'Qualificado',
      'Primeira Reunião Marcada', 'Reagendar Primeira Reunião',
      'Fazer Ilustração', 'Ilustração Agendada', 'Reagendar Ilustração',
      'Contrato Fechado', 'Aplicação', 'Apólice Emitida', 'Cliente Ativo', 'Perdido',
    ])
    expect(DEFAULT_CRM_STAGES.map((stage) => String(stage.name))).not.toContain('Todos')
    expect(new Set(DEFAULT_CRM_STAGES.map((stage) => stage.systemKey)).size).toBe(14)
  })
})
