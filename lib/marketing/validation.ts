import { z } from 'zod'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, LEAD_STATUSES } from './types'

export function formString(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

// IDs are opaque, including the stable founders-program ID seeded by migration.
const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
const nullableId = z.union([z.literal(''), id]).transform((value) => value || null)
const dateOnly = z.string().refine((value) => {
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}).transform((value) => value ? new Date(`${value}T00:00:00.000Z`) : null)

const budget = z.string().trim().refine((value) => !value || /^\d{1,8}(\.\d{1,2})?$/.test(value))
  .transform((value) => value ? Math.round(Number(value) * 100) : null)
  .refine((value) => value === null || (Number.isSafeInteger(value) && value <= 2_147_483_647))

export const campaignSchema = z.object({
  id: nullableId,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).transform((value) => value || null),
  channel: z.enum(CAMPAIGN_CHANNELS),
  status: z.enum(CAMPAIGN_STATUSES),
  budget,
  startsAt: dateOnly,
  endsAt: dateOnly,
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && value.endsAt < value.startsAt) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date precedes start date' })
  }
})

export const leadUpdateSchema = z.object({
  id,
  status: z.enum(LEAD_STATUSES),
  ownerId: nullableId,
  nextContactAt: z.union([z.literal(''), z.iso.datetime({ offset: true })])
    .transform((value) => value ? new Date(value) : null),
})
export const noteSchema = z.object({ leadId: id, body: z.string().trim().min(1).max(4000) })
export const bulkLeadSchema = z.object({
  ids: z.array(id).min(1).max(100).transform((values) => [...new Set(values)]),
  status: z.enum(LEAD_STATUSES),
})

type Copy = (portuguese: string, english: string) => string
export function marketingFieldErrors(error: z.ZodError, copy: Copy): Record<string, string[]> {
  const messages: Record<string, string> = {
    id: copy('Registro inválido.', 'Invalid record.'),
    leadId: copy('Lead inválido.', 'Invalid lead.'),
    name: copy('Informe um nome entre 2 e 120 caracteres.', 'Enter a name between 2 and 120 characters.'),
    description: copy('Use no máximo 2.000 caracteres.', 'Use up to 2,000 characters.'),
    channel: copy('Selecione um canal válido.', 'Select a valid channel.'),
    status: copy('Selecione um status válido.', 'Select a valid status.'),
    budget: copy('Informe um valor em USD válido, com até duas casas decimais.', 'Enter a valid USD amount with up to two decimal places.'),
    startsAt: copy('Informe uma data inicial válida.', 'Enter a valid start date.'),
    endsAt: copy('A data final deve ser válida e igual ou posterior à inicial.', 'The end date must be valid and on or after the start date.'),
    ownerId: copy('Selecione um responsável válido.', 'Select a valid owner.'),
    nextContactAt: copy('Informe uma data e hora válidas.', 'Enter a valid date and time.'),
    body: copy('Escreva uma nota de 1 a 4.000 caracteres.', 'Write a note between 1 and 4,000 characters.'),
    ids: copy('Selecione de 1 a 100 leads.', 'Select between 1 and 100 leads.'),
  }
  const result: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0])
    result[key] = [messages[key] ?? copy('Valor inválido.', 'Invalid value.')]
  }
  return result
}
