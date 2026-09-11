import type { ProposalCategory } from '@/lib/kbot-messaging/scheduled-triggers'
import type { TemplateValues } from './variables'

/// The categories an agent can write a template for — re-exported, never
/// redeclared.
///
/// This list decides what `setScheduledCategoryEnabled` accepts, and the
/// proposal engine decides what it raises. A second copy here already drifted
/// once: the engine gained `LAPSE_RECOVERY` and this list did not, so no agent
/// could enable the template, and the engine refuses to propose without one —
/// a feature switched off by a constant in another file.
///
/// `scheduled-triggers` is pure (its only import is the timezone table), so the
/// client bundle can read this.
export {
  PROPOSAL_CATEGORIES as SCHEDULED_CATEGORIES,
  type ProposalCategory as ScheduledCategory,
} from '@/lib/kbot-messaging/scheduled-triggers'
import { PROPOSAL_CATEGORIES } from '@/lib/kbot-messaging/scheduled-triggers'

export const TEMPLATE_LANGUAGES = ['PT', 'EN'] as const
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number]

export function isScheduledCategory(value: string): value is ProposalCategory {
  return (PROPOSAL_CATEGORIES as readonly string[]).includes(value)
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
