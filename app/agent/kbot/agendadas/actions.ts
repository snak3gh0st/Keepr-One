'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentAgent } from '@/lib/agent-context'
import { lockAgent } from '@/lib/kbot-followup/credits'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { approveScheduledMessages, discardScheduledMessages } from '@/lib/kbot-messaging/approval'
import { canSendUnread, SCHEDULED_CATEGORIES, sampleValues, TEMPLATE_LANGUAGES } from '@/lib/kbot-templates/categories'
import {
  TEMPLATE_BODY_MAX_LENGTH,
  validateTemplateBody,
  type TemplateBodyError,
} from '@/lib/kbot-templates/variables'

export type ScheduledActionResult =
  | { ok: true; preview?: string; released?: number }
  | { ok: false; message: string }

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

const autoSendSchema = z.strictObject({
  category: z.enum(SCHEDULED_CATEGORIES),
  autoSend: z.boolean(),
})

/// The screen never sends an agent id — the agent comes from the session, and
/// `approval.ts` filters on it again. Bounded because the queue itself is
/// bounded: a list longer than this is not a screen anyone read.
const proposalsSchema = z.strictObject({
  jobIds: z.array(z.string().min(1).max(64)).min(1).max(200),
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
      // Serialized against the category switch below. Without it, this can read
      // "category is on", the switch can turn every existing row off and
      // commit, and this can then create the new language row `enabled: true` —
      // a category the screen reports as off, still sending in one language.
      await lockAgent(tx, agent.id)
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
      // Same lock as the save above: the two decide the same field.
      await lockAgent(tx, agent.id)
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

/// Turns automatic sending on or off for a whole category.
///
/// This is not the same decision as `setScheduledCategoryEnabled`. Activating a
/// category says "prepare these messages for me"; this one says "and send them
/// without asking me". `autoSend` lives per (category, language) because it sits
/// on the template row, but nobody means "send birthdays unattended in English
/// only" — so every language row moves together, under the same lock the other
/// two writers take.
///
/// Turning it on requires text in every row of the category. Automatic sending
/// is the promotion of a message the agent approved, never the model writing
/// where nobody reads: a row whose `body` is null tells the dispatch path to
/// write the text itself, and the engine reads the row for the agent's own
/// language, so a single blank row is enough for free-form text about someone's
/// policy to reach them unread. Turning it *off* is never gated — nobody has to
/// justify wanting to read their own messages again.
export async function setScheduledCategoryAutoSend(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = autoSendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  const { category, autoSend } = parsed.data
  try {
    const agent = await currentAgent()
    const outcome = await prisma.$transaction(async (tx) => {
      await lockAgent(tx, agent.id)
      const rows = await tx.kBotMessageTemplate.findMany({
        where: { agentId: agent.id, category },
        select: { body: true },
      })
      if (!rows.length) return 'NO_CATEGORY' as const
      if (autoSend && !canSendUnread(rows)) return 'NO_TEXT' as const
      await tx.kBotMessageTemplate.updateMany({
        where: { agentId: agent.id, category },
        data: { autoSend },
      })
      return 'WRITTEN' as const
    })
    if (outcome === 'NO_CATEGORY') {
      return {
        ok: false,
        message: copy(
          'Escreva e salve a mensagem desta categoria antes de mudar o envio.',
          'Write and save this category message before changing how it is sent.',
        ),
      }
    }
    if (outcome === 'NO_TEXT') {
      return {
        ok: false,
        message: copy(
          'O envio automático manda o texto que você aprovou. Salve a mensagem desta categoria em cada idioma antes de ligar.',
          'Automatic sending delivers the text you approved. Save this category message in each language before turning it on.',
        ),
      }
    }
    revalidatePath(PATH)
    return { ok: true }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}

/// Releases the proposals the agent read and chose to send.
///
/// The agent id comes from the session and never from the request body, so no
/// screen — stale, forged or otherwise — can release another agent's message.
export async function approveScheduledProposals(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = proposalsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  try {
    const agent = await currentAgent()
    const { released } = await approveScheduledMessages(agent.id, parsed.data.jobIds)
    revalidatePath(PATH)
    return { ok: true, released }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}

/// Drops the proposals the agent read and chose not to send. The reservation
/// goes back with them — `discardScheduledMessages` settles the job rather than
/// flipping a status.
export async function discardScheduledProposals(input: unknown): Promise<ScheduledActionResult> {
  const { copy } = await getServerI18n()
  const parsed = proposalsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: unavailable(copy) }
  try {
    const agent = await currentAgent()
    const { released } = await discardScheduledMessages(agent.id, parsed.data.jobIds)
    revalidatePath(PATH)
    return { ok: true, released }
  } catch {
    return { ok: false, message: unavailable(copy) }
  }
}
