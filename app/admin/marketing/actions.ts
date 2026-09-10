'use server'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { bulkLeadSchema, campaignSchema, formString, leadUpdateSchema, marketingFieldErrors, noteSchema } from '@/lib/marketing/validation'
import type { MarketingActionResult } from '@/lib/marketing/types'

async function actionContext() {
  const session = await requireRole('ADMIN')
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'), host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'), forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const { copy } = await getServerI18n()
  return { session, copy }
}

function revalidateMarketing(leadId?: string, campaignId?: string) {
  revalidatePath('/admin/marketing')
  revalidatePath('/admin/marketing/leads')
  revalidatePath('/admin/marketing/campaigns')
  revalidatePath('/admin/audit')
  if (leadId) revalidatePath(`/admin/marketing/leads/${leadId}`)
  if (campaignId) revalidatePath(`/admin/marketing/campaigns/${campaignId}`)
}

function campaignSlug(name: string): string {
  const stem = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/, '') || 'campaign'
  return `${stem}-${randomUUID().slice(0, 8)}`
}

// Dates must become strings before being included in Prisma's JSON audit fields.
function auditValue(value: object): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject
}

function errorCode(error: unknown) {
  return error instanceof Error ? error.message : ''
}

export async function saveCampaignAction(formData: FormData): Promise<MarketingActionResult> {
  const { session, copy } = await actionContext()
  const parsed = campaignSchema.safeParse(Object.fromEntries(
    ['id', 'name', 'description', 'channel', 'status', 'budget', 'startsAt', 'endsAt'].map((key) => [key, formString(formData, key)]),
  ))
  if (!parsed.success) return { ok: false, message: copy('Revise os campos destacados.', 'Review the highlighted fields.'), fieldErrors: marketingFieldErrors(parsed.error, copy) }
  const { id, budget, ...fields } = parsed.data
  const data = { ...fields, budgetCents: budget }
  try {
    const campaign = await prisma.$transaction(async (tx) => {
      const before = id ? await tx.marketingCampaign.findUnique({ where: { id } }) : null
      if (id && !before) throw new Error('NOT_FOUND')
      const saved = id
        ? await tx.marketingCampaign.update({ where: { id }, data })
        : await tx.marketingCampaign.create({ data: { ...data, slug: campaignSlug(data.name) } })
      await tx.auditLog.create({ data: {
        userId: session.user.id, action: id ? 'MARKETING_CAMPAIGN_UPDATED' : 'MARKETING_CAMPAIGN_CREATED',
        entity: 'MarketingCampaign', entityId: saved.id,
        ...(before ? { before: auditValue(before) } : {}), after: auditValue(saved),
      } })
      return saved
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    revalidateMarketing(undefined, campaign.id)
    return { ok: true, id: campaign.id }
  } catch (error) {
    return { ok: false, message: errorCode(error) === 'NOT_FOUND'
      ? copy('Campanha não encontrada. Atualize a página.', 'Campaign not found. Refresh the page.')
      : copy('Não foi possível salvar a campanha agora.', 'We could not save the campaign right now.') }
  }
}

export async function updateLeadAction(formData: FormData): Promise<MarketingActionResult> {
  const { session, copy } = await actionContext()
  const parsed = leadUpdateSchema.safeParse(Object.fromEntries(
    ['id', 'status', 'ownerId', 'nextContactAt'].map((key) => [key, formString(formData, key)]),
  ))
  if (!parsed.success) return { ok: false, message: copy('Revise os campos destacados.', 'Review the highlighted fields.'), fieldErrors: marketingFieldErrors(parsed.error, copy) }
  const { id, ...data } = parsed.data
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.marketingLead.findUnique({ where: { id }, select: { status: true, ownerId: true, nextContactAt: true } })
      if (!before) throw new Error('NOT_FOUND')
      if (data.ownerId) {
        const owner = await tx.user.findFirst({ where: { id: data.ownerId, role: 'ADMIN', banned: false }, select: { id: true } })
        if (!owner) throw new Error('INVALID_OWNER')
      }
      await tx.marketingLead.update({ where: { id }, data })
      await tx.auditLog.create({ data: {
        userId: session.user.id, action: 'MARKETING_LEAD_UPDATED', entity: 'MarketingLead', entityId: id,
        before: auditValue(before), after: auditValue(data),
      } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    revalidateMarketing(id)
    return { ok: true, id }
  } catch (error) {
    if (errorCode(error) === 'INVALID_OWNER') {
      const message = copy('Selecione um administrador ativo como responsável.', 'Select an active administrator as owner.')
      return { ok: false, message, fieldErrors: { ownerId: [message] } }
    }
    return { ok: false, message: errorCode(error) === 'NOT_FOUND'
      ? copy('Lead não encontrado. Atualize a página.', 'Lead not found. Refresh the page.')
      : copy('Não foi possível atualizar o lead agora.', 'We could not update the lead right now.') }
  }
}

export async function addLeadNoteAction(formData: FormData): Promise<MarketingActionResult> {
  const { session, copy } = await actionContext()
  const parsed = noteSchema.safeParse({ leadId: formString(formData, 'leadId'), body: formString(formData, 'body') })
  if (!parsed.success) return { ok: false, message: copy('Revise os campos destacados.', 'Review the highlighted fields.'), fieldErrors: marketingFieldErrors(parsed.error, copy) }
  try {
    const note = await prisma.$transaction(async (tx) => {
      const lead = await tx.marketingLead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true } })
      if (!lead) throw new Error('NOT_FOUND')
      const saved = await tx.marketingLeadNote.create({ data: { ...parsed.data, authorId: session.user.id } })
      await tx.auditLog.create({ data: {
        userId: session.user.id, action: 'MARKETING_LEAD_NOTE_ADDED', entity: 'MarketingLead', entityId: parsed.data.leadId,
        after: { noteId: saved.id },
      } })
      return saved
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    revalidateMarketing(parsed.data.leadId)
    return { ok: true, id: note.id }
  } catch (error) {
    return { ok: false, message: errorCode(error) === 'NOT_FOUND'
      ? copy('Lead não encontrado. Atualize a página.', 'Lead not found. Refresh the page.')
      : copy('Não foi possível adicionar a nota agora.', 'We could not add the note right now.') }
  }
}

export async function bulkUpdateLeadStatusAction(formData: FormData): Promise<MarketingActionResult> {
  const { session, copy } = await actionContext()
  const parsed = bulkLeadSchema.safeParse({ ids: formData.getAll('ids'), status: formString(formData, 'status') })
  if (!parsed.success) return { ok: false, message: copy('Revise a seleção de leads.', 'Review the lead selection.'), fieldErrors: marketingFieldErrors(parsed.error, copy) }
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.marketingLead.findMany({ where: { id: { in: parsed.data.ids } }, select: { id: true, status: true } })
      if (before.length !== parsed.data.ids.length) throw new Error('NOT_FOUND')
      const updated = await tx.marketingLead.updateMany({ where: { id: { in: parsed.data.ids } }, data: { status: parsed.data.status } })
      if (updated.count !== before.length) throw new Error('NOT_FOUND')
      await tx.auditLog.createMany({ data: before.map((lead) => ({
        userId: session.user.id, action: 'MARKETING_LEAD_STATUS_UPDATED', entity: 'MarketingLead', entityId: lead.id,
        before: { status: lead.status }, after: { status: parsed.data.status },
      })) })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    revalidateMarketing()
    for (const id of parsed.data.ids) revalidatePath(`/admin/marketing/leads/${id}`)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: errorCode(error) === 'NOT_FOUND'
      ? copy('Um lead da seleção não existe mais. Atualize a página e tente novamente.', 'A selected lead no longer exists. Refresh the page and try again.')
      : copy('Não foi possível atualizar os leads agora.', 'We could not update the leads right now.') }
  }
}
