import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { getCurrentAgent } from '@/lib/agent-context'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { AWAITING_APPROVAL } from '@/lib/kbot-followup/domain'
import { canSendUnread, SCHEDULED_CATEGORIES, TEMPLATE_LANGUAGES } from '@/lib/kbot-templates/categories'
import { toScheduledEntry } from '@/lib/kbot-templates/schedule-view'
import { ScheduledMessagesWorkspace, type ScheduledMessagesView } from './ScheduledMessagesWorkspace'

export const dynamic = 'force-dynamic'

export default async function KBotScheduledMessagesPage() {
  const agent = await getCurrentAgent()
  // The columns both job queries read. Written once so the approval queue and
  // the delivery list cannot drift into showing different facts about a row.
  const jobFields = {
    id: true, category: true, customerName: true, phone: true, language: true,
    status: true, errorCode: true, content: true, createdAt: true, updatedAt: true,
  } as const
  const [user, templates, jobs, consent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: agent.userId }, select: { name: true } }),
    prisma.kBotMessageTemplate.findMany({
      where: { agentId: agent.id, category: { in: [...SCHEDULED_CATEGORIES] } },
      select: { category: true, language: true, body: true, enabled: true, autoSend: true, updatedAt: true },
    }),
    // The queue of proposals waiting for approval now lives in
    // `/agent/mensagens` — this screen only reads what already happened.
    prisma.kBotFollowupJob.findMany({
      where: { agentId: agent.id, category: { in: [...SCHEDULED_CATEGORIES] }, status: { not: AWAITING_APPROVAL } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: jobFields,
    }),
    prisma.kBotContactConsentEvent.findMany({
      where: { agentId: agent.id },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      select: { id: true, subjectKey: true, action: true, source: true, evidence: true, snoozedUntil: true, occurredAt: true },
    }),
  ])
  // The consent events are the history; `KBotContactPreference` is the state
  // the send gate actually reads. They are not mirrors: an opt-out made in the
  // follow-up screen or arriving as a WhatsApp "stop" reply writes only the
  // preference. Reading the button label off the event log would show "opted
  // out" as available for exactly the people who already asked to stop.
  const preferences = await prisma.kBotContactPreference.findMany({
    where: { agentId: agent.id, subjectKey: { in: Array.from(new Set(jobs.map((job) => job.phone))) } },
    select: { subjectKey: true, optedOut: true, snoozedUntil: true },
  })
  const { copy } = await getServerI18n()

  const view: ScheduledMessagesView = {
    categories: SCHEDULED_CATEGORIES.map((category) => ({
      category,
      // A category counts as on only when its rows say so. An agent who never
      // opened this screen has no rows at all, which reads as off.
      enabled: templates.some((template) => template.category === category && template.enabled),
      // Same reading as `enabled`: the switch is about the category, so one
      // language row left behind must not report the category as unattended.
      autoSend: templates.some((template) => template.category === category && template.autoSend),
      // Whether the agent is even allowed to ask for automatic sending. Read
      // from the saved rows, never from what is in the textarea: automatic
      // means the approved text goes out, and text nobody saved was approved by
      // nobody. The server action asks the same question of the same rows.
      canAutoSend: canSendUnread(templates.filter((template) => template.category === category)),
      languages: TEMPLATE_LANGUAGES.map((language) => {
        const template = templates.find((row) => row.category === category && row.language === language)
        return {
          language,
          body: template?.body ?? '',
          updatedAt: template?.updatedAt.toISOString() ?? null,
        }
      }),
    })),
    entries: jobs.map(toScheduledEntry),
    contacts: preferences.map((preference) => ({
      subjectKey: preference.subjectKey,
      optedOut: preference.optedOut,
      snoozedUntil: preference.snoozedUntil?.toISOString() ?? null,
    })),
    consent: consent.map((event) => ({
      id: event.id,
      subjectKey: event.subjectKey,
      action: event.action,
      source: event.source,
      evidence: event.evidence,
      snoozedUntil: event.snoozedUntil?.toISOString() ?? null,
      occurredAt: event.occurredAt.toISOString(),
    })),
  }

  return <Shell role="AGENT" userName={user.name}>
    <header className="flex flex-wrap items-end justify-between gap-4 py-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-deep">K-Bot</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{copy('Mensagens agendadas', 'Scheduled messages')}</h1>
        <p className="mt-2 text-sm text-ink-muted">{copy('Escreva o texto de cada categoria, ative quando estiver pronto e acompanhe quem recebeu — e quem não recebeu.', 'Write the text for each category, turn it on when you are ready and track who received it — and who did not.')}</p>
      </div>
      <Link href="/agent/kbot" className="inline-flex min-h-11 items-center rounded-xl border border-border-steel bg-panel px-4 text-sm font-semibold text-teal-deep">{copy('Voltar ao follow-up', 'Back to follow-up')}</Link>
    </header>
    <ScheduledMessagesWorkspace view={view} />
  </Shell>
}
