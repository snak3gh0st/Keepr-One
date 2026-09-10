'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { SCHEDULED_CATEGORIES, sampleValues, TEMPLATE_LANGUAGES } from '@/lib/kbot-templates/categories'
import {
  TEMPLATE_BODY_MAX_LENGTH,
  validateTemplateBody,
  type TemplateBodyError,
} from '@/lib/kbot-templates/variables'

export type ScheduledActionResult = { ok: true; preview?: string } | { ok: false; message: string }

const PATH = '/agent/kbot/agendadas'

const templateSchema = z.strictObject({
  category: z.enum(SCHEDULED_CATEGORIES),
  language: z.enum(TEMPLATE_LANGUAGES),
  // Generous next to the real limit so an over-long body is reported as
  // "too long" with its length, instead of being rejected as malformed input.
  body: z.string().max(TEMPLATE_BODY_MAX_LENGTH * 4),
})

const toggleSchema = z.strictObject({
  category: z.enum(SCHEDULED_CATEGORIES),
  enabled: z.boolean(),
})

/// Consent is recorded against the phone number, the same key
/// `lib/kbot-followup/worker.ts` uses when a client replies "stop" on WhatsApp.
/// Keeping both paths on one key is what makes the history a single story
/// instead of two half-stories that never meet.
const consentSchema = z.strictObject({
  subjectKey: z.string().regex(/^\+[0-9]{7,15}$/),
  optedOut: z.boolean(),
})

async function currentAgent() {
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  return getCurrentAgent()
}

function bodyMessage(error: TemplateBodyError, copy: (pt: string, en: string) => string): string {
  switch (error.code) {
    case 'EMPTY':
      return copy('Escreva a mensagem antes de salvar.', 'Write the message before saving.')
    case 'TOO_LONG':
    case 'RENDERED_TOO_LONG':
      return copy(
        `A mensagem ficou com ${error.length} caracteres. Reduza para até ${TEMPLATE_BODY_MAX_LENGTH}.`,
        `The message came to ${error.length} characters. Trim it to ${TEMPLATE_BODY_MAX_LENGTH} or fewer.`,
      )
    case 'MALFORMED':
      return copy(
        'Há uma chave {{ ou }} sem par na mensagem. Feche a variável antes de salvar.',
        'There is an unmatched {{ or }} in the message. Close the variable before saving.',
      )
    case 'UNKNOWN_VARIABLE':
      return copy(
        `Estas variáveis não existem: ${error.unknown.join(', ')}. Use apenas as da lista.`,
        `These variables do not exist: ${error.unknown.join(', ')}. Use only the ones listed.`,
      )
  }
}

const unavailable = (copy: (pt: string, en: string) => string) =>
  copy(
    'Não foi possível salvar agora. Tente novamente.',
    'We could not save this right now. Please try again.',
  )

/// Saves the text of one category in one language. A brand-new row is created
/// switched off: writing a message and turning the category on are two separate
/// decisions, and only the second one puts messages on a client's phone.
export async function saveScheduledTemplate(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = templateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  const { category, language, body } = parsed.data
  try {
    const agent = await currentAgent()
    const checked = validateTemplateBody(body, sampleValues(language))
    if (!checked.ok) return { ok: false, message: bodyMessage(checked.error, copy) }
    await prisma.$transaction(async (tx) => {
      // A brand-new row joins the category in the state the category is
      // already in. Hardcoding `false` here would mean that adding English to
      // a category the agent turned on months ago silently leaves English
      // clients unmessaged while the screen reports the category as active.
      // With no rows at all there is nothing to inherit, so the first template
      // is created switched off — the category is still born silent.
      const enabled = await tx.kBotMessageTemplate.count({ where: { agentId: agent.id, category, enabled: true } })
      await tx.kBotMessageTemplate.upsert({
        where: { agentId_category_language: { agentId: agent.id, category, language } },
        create: { agentId: agent.id, category, language, body: checked.body, enabled: enabled > 0 },
        update: { body: checked.body },
      })
    })
    revalidatePath(PATH)
    return { ok: true, preview: checked.preview }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}

/// Turns a whole category on or off.
///
/// `enabled` is stored per (category, language) because that is where the text
/// lives, but the agent's decision is about the category — nobody means "send
/// birthdays in English only". So the switch moves every language row of the
/// category together, in one transaction, and turning on requires text to
/// already exist.
export async function setScheduledCategoryEnabled(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = toggleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  const { category, enabled } = parsed.data
  try {
    const agent = await currentAgent()
    const written = await prisma.$transaction(async (tx) => {
      const existing = await tx.kBotMessageTemplate.count({ where: { agentId: agent.id, category } })
      if (!existing) return 0
      const result = await tx.kBotMessageTemplate.updateMany({
        where: { agentId: agent.id, category },
        data: { enabled },
      })
      return result.count
    })
    if (!written) {
      return {
        ok: false,
        message: copy(
          'Escreva e salve a mensagem desta categoria antes de ativá-la.',
          'Write and save this category message before turning it on.',
        ),
      }
    }
    revalidatePath(PATH)
    return { ok: true }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}

/// Records a consent decision the agent took on this screen.
///
/// Two writes, one transaction: the append-only event that says when and by
/// which route the person asked to stop, and the mutable projection the send
/// gate actually reads. A projection updated without its event would leave the
/// screen unable to answer "since when"; an event without the projection would
/// keep the messages going.
export async function setContactConsent(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = consentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  const { subjectKey, optedOut } = parsed.data
  try {
    const agent = await currentAgent()
    const preference = optedOut ? { optedOut: true } : { optedOut: false, snoozedUntil: null }
    await prisma.$transaction([
      prisma.kBotContactPreference.upsert({
        where: { agentId_subjectKey: { agentId: agent.id, subjectKey } },
        create: { agentId: agent.id, subjectKey, ...preference },
        update: preference,
      }),
      prisma.kBotContactConsentEvent.create({
        data: {
          agentId: agent.id,
          subjectKey,
          action: optedOut ? 'OPT_OUT' : 'OPT_IN',
          source: 'AGENT_UI',
        },
      }),
    ])
    revalidatePath(PATH)
    return { ok: true }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}
