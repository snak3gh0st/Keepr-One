import type { TemplateValues } from './variables'

/// The scheduled categories an agent can set up today. `KBotFollowupJob.category`
/// also carries `FOLLOWUP`, which is the agent-triggered path and is not
/// configured here.
export const SCHEDULED_CATEGORIES = ['BIRTHDAY', 'ANNUAL_REVIEW'] as const
export type ScheduledCategory = (typeof SCHEDULED_CATEGORIES)[number]

export const TEMPLATE_LANGUAGES = ['PT', 'EN'] as const
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]

export function isScheduledCategory(value: string): value is ScheduledCategory {
  return (SCHEDULED_CATEGORIES as readonly string[]).includes(value)
}

/// The names the preview is rendered with. Deliberately a real-looking person
/// and not `<nome>`: the point of the preview is to read like the message the
/// client will actually get, including its length.
export const SAMPLE_VALUES: Record<TemplateLanguage, TemplateValues> = {
  PT: { nome: 'Ana Ribeiro', primeiro_nome: 'Ana', agente: 'Paulo Loureiro' },
  EN: { nome: 'Ann Carter', primeiro_nome: 'Ann', agente: 'Paul Carver' },
}

export function sampleValues(language: string): TemplateValues {
  return language === 'EN' ? SAMPLE_VALUES.EN : SAMPLE_VALUES.PT
}
