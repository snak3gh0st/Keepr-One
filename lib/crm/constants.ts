export const DEFAULT_CRM_STAGES = [
  { systemKey: 'NEW_LEAD', name: 'Novo Lead' },
  { systemKey: 'FOLLOW_UP', name: 'Follow-up' },
  { systemKey: 'IN_CONTACT', name: 'Em Contato' },
  { systemKey: 'QUALIFIED', name: 'Qualificado' },
  { systemKey: 'FIRST_MEETING_SCHEDULED', name: 'Primeira Reunião Marcada' },
  { systemKey: 'RESCHEDULE_FIRST_MEETING', name: 'Reagendar Primeira Reunião' },
  { systemKey: 'CREATE_ILLUSTRATION', name: 'Fazer Ilustração' },
  { systemKey: 'ILLUSTRATION_SCHEDULED', name: 'Ilustração Agendada' },
  { systemKey: 'RESCHEDULE_ILLUSTRATION', name: 'Reagendar Ilustração' },
  { systemKey: 'CONTRACT_CLOSED', name: 'Contrato Fechado' },
  { systemKey: 'APPLICATION', name: 'Aplicação' },
  { systemKey: 'POLICY_ISSUED', name: 'Apólice Emitida' },
  { systemKey: 'ACTIVE_CLIENT', name: 'Cliente Ativo' },
  { systemKey: 'LOST', name: 'Perdido' },
] as const

export type DefaultCrmStageKey = (typeof DEFAULT_CRM_STAGES)[number]['systemKey']

export const FOLLOW_UP_STAGE_KEY: DefaultCrmStageKey = 'FOLLOW_UP'
