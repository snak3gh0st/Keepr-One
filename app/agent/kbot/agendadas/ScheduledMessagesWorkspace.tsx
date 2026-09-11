'use client'

import { useMemo, useState, useTransition } from 'react'
import { browserClock, useBrowserClock } from '@/components/useBrowserClock'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import type { SendGateBlockReason } from '@/lib/kbot-messaging/send-gate'
import { sampleValues, type ScheduledCategory, type TemplateLanguage } from '@/lib/kbot-templates/categories'
import { approvalTimeLeft, canApprove, type ApprovalProposal } from '@/lib/kbot-templates/approval-view'
import { blockedReasonTotals, type ScheduledBucket, type ScheduledEntry } from '@/lib/kbot-templates/schedule-view'
import {
  renderTemplate,
  TEMPLATE_BODY_MAX_LENGTH,
  TEMPLATE_VARIABLES,
  unknownVariables,
  hasStrayBraces,
} from '@/lib/kbot-templates/variables'
import {
  approveScheduledProposals,
  discardScheduledProposals,
  saveScheduledTemplate,
  setContactConsent,
  setScheduledCategoryAutoSend,
  setScheduledCategoryEnabled,
} from './actions'

export type ScheduledMessagesView = {
  categories: Array<{
    category: ScheduledCategory
    enabled: boolean
    /// Whether this category's messages leave without the agent reading them.
    autoSend: boolean
    /// Whether the agent may turn automatic sending on at all. False while any
    /// row of the category has no saved text: the K-Bot would be writing where
    /// nobody reads, which automatic sending has never meant.
    canAutoSend: boolean
    languages: Array<{ language: TemplateLanguage; body: string; updatedAt: string | null }>
  }>
  /// Messages already written and waiting for the agent to release them.
  proposals: ApprovalProposal[]
  entries: ScheduledEntry[]
  /// The projection the send gate reads, for the contacts on screen. Separate
  /// from `consent` on purpose: the events are the story, this is the state.
  contacts: Array<{ subjectKey: string; optedOut: boolean; snoozedUntil: string | null }>
  consent: Array<{
    id: string
    subjectKey: string
    action: string
    source: string
    evidence: string | null
    snoozedUntil: string | null
    occurredAt: string
  }>
}

const button = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:opacity-40 disabled:cursor-not-allowed'
const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border-steel bg-panel px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-teal-pale disabled:opacity-40 disabled:cursor-not-allowed'

export function ScheduledMessagesWorkspace({ view }: { view: ScheduledMessagesView }) {
  const { copy, locale } = useI18n()
  const [section, setSection] = useState<'templates' | 'schedule' | 'consent'>('templates')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  // Typed by the category union rather than `string`, so a category added to
  // the engine fails to compile here instead of rendering with no name.
  const categoryLabels: Record<ScheduledCategory, string> = {
    BIRTHDAY: copy('Aniversário', 'Birthday'),
    ANNUAL_REVIEW: copy('Revisão anual', 'Annual review'),
    LAPSE_RECOVERY: copy('Recuperação de lapso', 'Lapse recovery'),
  }
  // The column is free text in the database, so the lookup takes a string while
  // the table above stays exhaustive over the union.
  const categoryLabel = (value: string) => categoryLabels[value as ScheduledCategory] ?? value
  /// The single most useful line on the screen: why a client did not hear from
  /// the agent. Each one is written as the fact, not as an error code.
  const blockLabels: Record<SendGateBlockReason, string> = {
    OPTED_OUT: copy('Pediu para não receber', 'Asked not to be contacted'),
    SNOOZED: copy('Adiado por você', 'Snoozed by you'),
    RECENT_CONTACT: copy('Já teve contato nos últimos 7 dias', 'Already contacted in the last 7 days'),
    QUIET_HOURS: copy('Fora do horário do cliente', 'Outside the client’s hours'),
  }
  const blockDetails: Record<SendGateBlockReason, string> = {
    OPTED_OUT: copy('O cliente está marcado para não receber mensagens. Só volta a receber se você reativar.', 'This client is marked as opted out. They only receive messages again if you restore them.'),
    SNOOZED: copy('O contato está adiado até a data registrada.', 'This contact is snoozed until the recorded date.'),
    RECENT_CONTACT: copy('Uma mensagem de qualquer categoria — ou um contato manual seu — aconteceu dentro da janela de 7 dias.', 'A message of any category — or a manual contact of yours — happened inside the 7-day window.'),
    QUIET_HOURS: copy('Era madrugada ou noite no fuso do cliente. A mensagem volta para a fila e sai na próxima passagem dentro do horário dele.', 'It was night in the client’s time zone. The message goes back in the queue and leaves on the next pass, within their hours.'),
  }
  const bucketLabels: Record<ScheduledBucket, string> = {
    AWAITING_APPROVAL: copy('Esperando você', 'Waiting for you'),
    SCHEDULED: copy('Agendadas', 'Scheduled'),
    SENT: copy('Enviadas', 'Sent'),
    BLOCKED: copy('Barradas', 'Held back'),
    ATTENTION: copy('Precisam de você', 'Need your attention'),
  }
  const consentLabels: Record<string, string> = {
    OPT_OUT: copy('Pediu para não receber', 'Asked not to be contacted'),
    OPT_IN: copy('Voltou a receber', 'Contact allowed again'),
    SNOOZE: copy('Contato adiado', 'Contact snoozed'),
  }
  const sourceLabels: Record<string, string> = {
    WHATSAPP_REPLY: copy('resposta no WhatsApp', 'WhatsApp reply'),
    AGENT_UI: copy('registrado por você', 'recorded by you'),
    SYSTEM: copy('automático', 'automatic'),
  }

  function run(
    work: () => Promise<{ ok: true; preview?: string; released?: number } | { ok: false; message: string }>,
    success: string | ((released: number) => string),
  ) {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await work()
      // The count comes from the server, not from what was on screen: a
      // proposal that expired or was already released between the render and
      // the click matches nothing, and saying "3 sent" over 1 would be a lie.
      if (result.ok) setNotice(typeof success === 'string' ? success : success(result.released ?? 0))
      else setError(result.message)
    })
  }

  const [bucket, setBucket] = useState<ScheduledBucket>('BLOCKED')
  const entries = view.entries.filter((entry) => entry.bucket === bucket)
  const totals = useMemo(() => blockedReasonTotals(view.entries), [view.entries])
  const counts = view.entries.reduce<Record<string, number>>((result, entry) => {
    result[entry.bucket] = (result[entry.bucket] ?? 0) + 1
    return result
  }, {})
  const eventsBySubject = view.consent.reduce<Record<string, ScheduledMessagesView['consent']>>((result, event) => {
    (result[event.subjectKey] ??= []).push(event)
    return result
  }, {})
  const optedOutNow = (subjectKey: string) =>
    view.contacts.some((contact) => contact.subjectKey === subjectKey && contact.optedOut)
  const when = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })

  return <section className="my-4 rounded-2xl border border-border-steel bg-panel p-4 sm:p-6" aria-label={copy('Mensagens agendadas do K-Bot', 'K-Bot scheduled messages')}>
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex items-center gap-3">
        <KBotAvatar state={view.categories.some((c) => c.enabled) ? 'idle' : 'waiting'} />
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">{copy('Aniversário e revisão anual', 'Birthday and annual review')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{copy('Nenhuma categoria envia nada enquanto você não ativar.', 'No category sends anything until you turn it on.')}</p>
        </div>
      </div>
    </div>

    {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-teal-pale p-3 text-sm text-teal-deep">{notice}</p>}

    <ApprovalQueue
      proposals={view.proposals}
      categoryLabels={categoryLabels}
      pending={pending}
      onApprove={(jobIds) => run(
        () => approveScheduledProposals({ jobIds }),
        (released) => copy(
          `${released} mensagem(ns) liberada(s). Saem na próxima passagem, dentro do horário do cliente.`,
          `${released} message(s) released. They leave on the next pass, within the client’s hours.`,
        ),
      )}
      onDiscard={(jobIds) => run(
        () => discardScheduledProposals({ jobIds }),
        (released) => copy(
          `${released} mensagem(ns) descartada(s). Nada foi enviado e o crédito voltou.`,
          `${released} message(s) discarded. Nothing was sent and the credit came back.`,
        ),
      )}
    />

    <nav className="mt-5 flex flex-wrap gap-2 border-y border-border-steel py-3" aria-label={copy('Áreas de mensagens agendadas', 'Scheduled message areas')}>
      {([
        ['templates', copy('Modelos', 'Templates')],
        ['schedule', copy('Envios', 'Deliveries')],
        ['consent', copy('Consentimento', 'Consent')],
      ] as const).map(([id, label]) => <button key={id} className={section === id ? button : secondary} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
    </nav>

    {section === 'templates' && <div className="mt-5 grid gap-5">
      {view.categories.map((entry) => <CategoryEditor
        key={entry.category}
        entry={entry}
        label={categoryLabel(entry.category)}
        pending={pending}
        onSave={(language, body) => run(
          () => saveScheduledTemplate({ category: entry.category, language, body }),
          copy('Modelo salvo. A categoria continua como estava até você ativar.', 'Template saved. The category stays as it was until you turn it on.'),
        )}
        onToggle={(enabled) => run(
          () => setScheduledCategoryEnabled({ category: entry.category, enabled }),
          enabled
            ? copy('Categoria ativada. O K-Bot passa a agendar estas mensagens.', 'Category turned on. K-Bot will start scheduling these messages.')
            : copy('Categoria desativada. Nada mais é agendado nela.', 'Category turned off. Nothing else is scheduled for it.'),
        )}
        onAutoSend={(autoSend) => run(
          () => setScheduledCategoryAutoSend({ category: entry.category, autoSend }),
          autoSend
            ? copy('A partir de agora estas mensagens saem sozinhas, sem passar por você.', 'From now on these messages go out on their own, without passing through you.')
            : copy('Voltamos a perguntar. As próximas mensagens esperam você liberar.', 'We will ask again. The next messages wait for you to release them.'),
        )}
      />)}
    </div>}

    {section === 'schedule' && <div className="mt-5">
      {totals.length > 0 && <div className="rounded-xl border border-border-steel bg-paper p-4">
        <h3 className="text-sm font-semibold text-ink">{copy('Por que estes clientes não receberam', 'Why these clients did not receive a message')}</h3>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3 text-sm tabular-nums">
          {totals.map((row) => <div key={row.reason}>
            <dt className="text-xs text-ink-muted">{blockLabels[row.reason]}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{row.total}</dd>
          </div>)}
        </dl>
      </div>}
      <nav className="mt-4 flex flex-wrap gap-2" aria-label={copy('Filtrar envios', 'Filter deliveries')}>
        {(['BLOCKED', 'SCHEDULED', 'SENT', 'ATTENTION'] as const).map((id) => <button key={id} aria-pressed={bucket === id} className={bucket === id ? `${secondary} border-teal bg-teal-pale text-teal-deep` : secondary} onClick={() => setBucket(id)}>{bucketLabels[id]}<span className="ml-2 text-xs tabular-nums">{counts[id] ?? 0}</span></button>)}
      </nav>
      <div className="mt-4 divide-y divide-border-steel">
        {!entries.length && <p className="py-8 text-center text-sm text-ink-muted">{copy('Nada nesta lista por enquanto.', 'Nothing in this list yet.')}</p>}
        {entries.map((entry) => <article key={entry.id} className="flex flex-col justify-between gap-3 py-4 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <h3 className="break-words font-semibold text-ink">{entry.customerName}</h3>
            <p className="mt-1 text-sm text-ink-muted">{categoryLabel(entry.category)} · {when(entry.updatedAt)}</p>
            {entry.bucket === 'BLOCKED' && <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink">
              <span className="font-semibold">{entry.blockedReason ? blockLabels[entry.blockedReason] : copy('Barrada sem motivo registrado', 'Held back with no recorded reason')}</span>
              {entry.blockedReason && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{blockDetails[entry.blockedReason]}</span>}
            </p>}
            {entry.bucket !== 'BLOCKED' && entry.content && <p className="mt-2 max-w-xl whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted">{entry.content}</p>}
            {!!eventsBySubject[entry.phone]?.length && <details className="mt-2 text-sm">
              <summary className="min-h-11 cursor-pointer py-2 text-teal-deep">{copy('Histórico de consentimento', 'Consent history')}</summary>
              <ConsentList events={eventsBySubject[entry.phone]} labels={consentLabels} sources={sourceLabels} when={when} copy={copy} />
            </details>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button className={secondary} disabled={pending} onClick={() => run(
              () => setContactConsent({ subjectKey: entry.phone, optedOut: !optedOutNow(entry.phone) }),
              optedOutNow(entry.phone)
                ? copy('Contato liberado. O registro fica no histórico.', 'Contact allowed again. The record stays in the history.')
                : copy('Registrado. Este cliente não recebe mais mensagens agendadas.', 'Recorded. This client no longer receives scheduled messages.'),
            )}>{optedOutNow(entry.phone) ? copy('Permitir contato novamente', 'Allow contact again') : copy('Cliente pediu para não receber', 'Client opted out')}</button>
          </div>
        </article>)}
      </div>
    </div>}

    {section === 'consent' && <div className="mt-5">
      <p className="text-sm text-ink-muted">{copy('Cada linha é um registro permanente: quando a pessoa pediu para parar e por qual via.', 'Each line is a permanent record: when the person asked to stop, and through which route.')}</p>
      {!view.consent.length
        ? <p className="py-8 text-center text-sm text-ink-muted">{copy('Nenhum pedido registrado até agora.', 'No requests recorded so far.')}</p>
        : <div className="mt-4 grid gap-4">
          {Object.entries(eventsBySubject).map(([subjectKey, events]) => <article key={subjectKey} className="rounded-xl border border-border-steel bg-paper p-4">
            <h3 className="font-semibold tabular-nums text-ink">{subjectKey}</h3>
            <ConsentList events={events} labels={consentLabels} sources={sourceLabels} when={when} copy={copy} />
          </article>)}
        </div>}
    </div>}
  </section>
}

function ConsentList({ events, labels, sources, when, copy }: {
  events: ScheduledMessagesView['consent']
  labels: Record<string, string>
  sources: Record<string, string>
  when: (value: string) => string
  copy: (pt: string, en: string) => string
}) {
  return <ol className="mt-2 grid gap-2">
    {events.map((event) => <li key={event.id} className="text-xs leading-relaxed text-ink-muted">
      <span className="font-semibold text-ink">{labels[event.action] ?? event.action}</span>
      {' · '}{when(event.occurredAt)}{' · '}{sources[event.source] ?? event.source}
      {event.snoozedUntil && <span>{' · '}{copy('até', 'until')} {when(event.snoozedUntil)}</span>}
      {event.evidence && <q className="mt-1 block break-words italic">{event.evidence}</q>}
    </li>)}
  </ol>
}

function CategoryEditor({ entry, label, pending, onSave, onToggle, onAutoSend }: {
  entry: ScheduledMessagesView['categories'][number]
  label: string
  pending: boolean
  onSave: (language: TemplateLanguage, body: string) => void
  onToggle: (enabled: boolean) => void
  onAutoSend: (autoSend: boolean) => void
}) {
  const { copy } = useI18n()
  const [language, setLanguage] = useState<TemplateLanguage>(entry.languages[0].language)
  // Turning automatic sending on is the only thing on this screen that puts a
  // message on someone's phone without a person reading it, so it is the only
  // thing that asks twice. Turning it off goes straight through: nobody needs
  // to confirm that they want to read their own messages again.
  const [confirming, setConfirming] = useState(false)
  const [bodies, setBodies] = useState<Record<string, string>>(
    Object.fromEntries(entry.languages.map((row) => [row.language, row.body])),
  )
  const body = bodies[language] ?? ''
  const unknown = unknownVariables(body)
  const malformed = !unknown.length && hasStrayBraces(body)
  const rendered = renderTemplate(body, sampleValues(language))
  const tooLong = body.trim().length > TEMPLATE_BODY_MAX_LENGTH
  const savable = body.trim().length > 0 && !unknown.length && !malformed && !tooLong && rendered.ok

  return <article className="rounded-xl border border-border-steel bg-paper p-4" aria-label={label}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-ink">{label}</h3>
        <p className="mt-1 text-sm text-ink-muted">{entry.enabled
          ? copy('Ativa. As mensagens desta categoria são agendadas automaticamente.', 'On. Messages in this category are scheduled automatically.')
          : copy('Desligada. Nada é enviado nesta categoria.', 'Off. Nothing is sent in this category.')}</p>
      </div>
      <button
        className={entry.enabled ? secondary : button}
        disabled={pending}
        aria-pressed={entry.enabled}
        onClick={() => onToggle(!entry.enabled)}
      >{entry.enabled ? copy('Desativar categoria', 'Turn category off') : copy('Ativar categoria', 'Turn category on')}</button>
    </div>

    {/* Two different decisions, deliberately two different verbs. Activating
        the category means "prepare these messages for me"; this one means "and
        send them without asking me". */}
    <div className="mt-3 rounded-xl border border-border-steel bg-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{copy('Envio automático', 'Automatic sending')}</h4>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">{entry.autoSend
            ? copy('Ligado. As mensagens desta categoria saem sozinhas, sem você ler nenhuma antes.', 'On. Messages in this category go out on their own, without you reading any of them first.')
            : copy('Desligado. Cada mensagem desta categoria espera você ler e liberar.', 'Off. Every message in this category waits for you to read and release it.')}</p>
        </div>
        <button
          className={secondary}
          disabled={pending || (!entry.autoSend && !entry.canAutoSend)}
          aria-pressed={entry.autoSend}
          onClick={() => {
            if (entry.autoSend) onAutoSend(false)
            else setConfirming(true)
          }}
        >{entry.autoSend
          ? copy('Voltar a me perguntar', 'Ask me again')
          : copy('Mandar sem me perguntar', 'Send without asking me')}</button>
      </div>
      {/* Said where the button is, not after the click: offering a switch that
          the server will refuse is how an agent learns to distrust the screen. */}
      {!entry.autoSend && !entry.canAutoSend && <p className="mt-2 text-sm text-ink-muted">{copy(
        'Só depois de salvar o texto desta categoria em cada idioma. O envio automático manda o que você aprovou — sem texto salvo, ninguém teria lido o que sai.',
        'Only after this category text is saved in each language. Automatic sending delivers what you approved — with no saved text, nobody would have read what goes out.',
      )}</p>}
      {confirming && !entry.autoSend && <div role="alertdialog" aria-label={copy('Confirmar envio automático', 'Confirm automatic sending')} className="mt-3 rounded-xl bg-danger/10 p-3">
        <p className="text-sm leading-relaxed text-ink">{copy(
          `A partir daí, as mensagens de ${label} vão para o cliente sem passar por você. Você não vai ler nenhuma delas antes.`,
          `From then on, ${label} messages go to the client without passing through you. You will not read any of them first.`,
        )}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={button} disabled={pending} onClick={() => { setConfirming(false); onAutoSend(true) }}>{copy('Sim, mandar sem me perguntar', 'Yes, send without asking me')}</button>
          <button className={secondary} disabled={pending} onClick={() => setConfirming(false)}>{copy('Cancelar', 'Cancel')}</button>
        </div>
      </div>}
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      {entry.languages.map((row) => <button key={row.language} className={language === row.language ? `${secondary} border-teal bg-teal-pale text-teal-deep` : secondary} aria-pressed={language === row.language} onClick={() => setLanguage(row.language)}>{row.language === 'PT' ? 'Português' : 'English'}{!bodies[row.language]?.trim() && <span className="ml-2 text-xs text-ink-muted">{copy('K-Bot escreve', 'K-Bot writes')}</span>}</button>)}
    </div>
    {/* A category can be on with no text of its own. That used to mean nobody
        was messaged; it now means the K-Bot writes each message and the agent
        reads it before it goes. Saying "these clients receive nothing" would be
        telling every agent, on their first day, that the feature is broken.
        `!autoSend` is load-bearing, not defensive: this sentence promises the
        message waits, and with automatic sending on it does not. A category
        whose rows all carry text can still leave a language slot blank here —
        that is the ordinary shape after the migration — so without the guard
        the promise is made exactly where it is false. */}
    {entry.enabled && !entry.autoSend && entry.languages.some((row) => !bodies[row.language]?.trim()) && <p className="mt-2 text-sm text-ink-muted">{copy(
      'Sem texto salvo, o K-Bot escreve cada mensagem e ela espera você ler antes de sair.',
      'With no saved text, the K-Bot writes each message and it waits for you to read it before it goes.',
    )}</p>}

    <label className="mt-4 grid gap-1 text-xs text-ink-muted">
      {copy('Texto da mensagem', 'Message text')}
      <textarea
        className="min-h-32 rounded-xl border border-border-steel bg-panel p-3 text-sm text-ink"
        value={body}
        maxLength={TEMPLATE_BODY_MAX_LENGTH * 2}
        onChange={(event) => setBodies((previous) => ({ ...previous, [language]: event.target.value }))}
      />
    </label>
    <p className="mt-1 text-xs tabular-nums text-ink-muted">{body.trim().length}/{TEMPLATE_BODY_MAX_LENGTH}</p>

    <p className="mt-3 text-xs text-ink-muted">{copy('Variáveis disponíveis:', 'Available variables:')} {TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(' · ')}</p>

    {!!unknown.length && <p role="alert" className="mt-2 text-sm text-danger">{copy(
      `Estas variáveis não existem: ${unknown.join(', ')}. Corrija antes de salvar.`,
      `These variables do not exist: ${unknown.join(', ')}. Fix them before saving.`,
    )}</p>}
    {malformed && <p role="alert" className="mt-2 text-sm text-danger">{copy('Há uma chave {{ ou }} sem par na mensagem.', 'There is an unmatched {{ or }} in the message.')}</p>}
    {tooLong && <p role="alert" className="mt-2 text-sm text-danger">{copy('A mensagem está longa demais para o WhatsApp.', 'The message is too long for WhatsApp.')}</p>}

    <div className="mt-3 rounded-xl border border-border-steel bg-panel p-3">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-teal-deep">{copy('Prévia com dados de exemplo', 'Preview with sample data')}</h4>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{rendered.ok && body.trim()
        ? rendered.text
        : copy('A prévia aparece quando a mensagem estiver válida.', 'The preview appears once the message is valid.')}</p>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button className={button} disabled={pending || !savable} onClick={() => onSave(language, body)}>{copy('Salvar modelo', 'Save template')}</button>
      <span className="text-xs text-ink-muted">{copy('Salvar não ativa a categoria.', 'Saving does not turn the category on.')}</span>
    </div>
  </article>
}

const approvalClock = browserClock(60_000)

/// The queue of messages already written, waiting for a person to say yes.
///
/// It sits above everything else because it is the only part of this screen
/// with a deadline: a proposal nobody reads is dropped after the approval
/// window, and an agent who was never told that would read it as a bug.
function ApprovalQueue({ proposals, categoryLabels, pending, onApprove, onDiscard }: {
  proposals: ApprovalProposal[]
  categoryLabels: Record<string, string>
  pending: boolean
  onApprove: (jobIds: string[]) => void
  onDiscard: (jobIds: string[]) => void
}) {
  const { copy, locale } = useI18n()
  const [selected, setSelected] = useState<string[]>([])
  const now = useBrowserClock(approvalClock)

  const approvable = proposals.filter((proposal) => canApprove(proposal, now ?? 0))
  // Pruned against what is on screen right now. After a release the page
  // revalidates and those rows are gone; a leftover id would make the next
  // click report a send that matched nothing.
  const chosen = selected.filter((id) => proposals.some((proposal) => proposal.id === id))
  const chosenApprovable = chosen.filter((id) => approvable.some((proposal) => proposal.id === id))
  const allChosen = approvable.length > 0 && chosenApprovable.length === approvable.length

  function act(run: (jobIds: string[]) => void, jobIds: string[]) {
    if (!jobIds.length) return
    run(jobIds)
    setSelected([])
  }

  if (!proposals.length) return null

  return <section className="mt-5 rounded-2xl border border-teal bg-teal-pale/40 p-4" aria-label={copy('Mensagens esperando sua liberação', 'Messages waiting for your approval')}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-ink">{copy('Esperando você liberar', 'Waiting for you to release')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">{copy(
          'Estas mensagens já estão escritas com os dados de cada cliente. Leia antes de liberar — nada sai enquanto você não disser que sim.',
          'These messages are already written with each client’s details. Read them before releasing — nothing leaves until you say so.',
        )}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums text-teal-deep">{proposals.length}</p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        className={secondary}
        disabled={pending || !approvable.length}
        aria-pressed={allChosen}
        onClick={() => setSelected(allChosen ? [] : approvable.map((proposal) => proposal.id))}
      >{allChosen ? copy('Limpar seleção', 'Clear selection') : copy('Selecionar todas', 'Select all')}</button>
      <button className={button} disabled={pending || !chosenApprovable.length} onClick={() => act(onApprove, chosenApprovable)}>
        {copy('Enviar selecionadas', 'Send selected')}{chosenApprovable.length > 0 && <span className="ml-2 tabular-nums">{chosenApprovable.length}</span>}
      </button>
      <button className={secondary} disabled={pending || !chosen.length} onClick={() => act(onDiscard, chosen)}>
        {copy('Descartar selecionadas', 'Discard selected')}{chosen.length > 0 && <span className="ml-2 tabular-nums">{chosen.length}</span>}
      </button>
    </div>

    <ul className="mt-4 grid gap-3">
      {proposals.map((proposal) => {
        const left = now === null ? null : approvalTimeLeft(proposal.expiresAt, now)
        return <li key={proposal.id} className="rounded-xl border border-border-steel bg-panel p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-teal"
              // A proposal whose text cannot be produced is discardable but not
              // sendable, so the box only offers the choice the agent can make.
              checked={chosen.includes(proposal.id)}
              disabled={pending}
              onChange={(event) => setSelected((previous) => event.target.checked
                ? [...previous, proposal.id]
                : previous.filter((id) => id !== proposal.id))}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words font-semibold text-ink">{proposal.customerName}</span>
              <span className="mt-1 block text-sm text-ink-muted">
                {categoryLabels[proposal.category] ?? proposal.category}
                {' · '}<span className="tabular-nums">{proposal.phone}</span>
                {' · '}{proposal.language === 'PT' ? 'Português' : 'English'}
              </span>
              <span className="mt-1 block text-xs text-ink-muted">{left === null
                ? copy('Aguardando você.', 'Waiting for you.')
                : left.expired
                  ? copy('Expirou. Não sai mais, e o crédito volta na próxima passagem.', 'Expired. It no longer goes out, and the credit comes back on the next pass.')
                  : copy(
                    `Expira em ${left.hours}h${String(left.minutes).padStart(2, '0')} — depois disso, não sai mais.`,
                    `Expires in ${left.hours}h${String(left.minutes).padStart(2, '0')} — after that it no longer goes out.`,
                  )}</span>
            </span>
          </label>
          {/* The point of the whole screen: the exact text, as the client will
              read it. Plain text, never markup. */}
          {proposal.text !== null && <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-paper p-3 text-sm leading-relaxed text-ink">{proposal.text}</p>}
          {proposal.problem !== null && <p role="alert" className="mt-3 rounded-xl bg-danger/10 p-3 text-sm leading-relaxed text-danger">
            {proposal.problem === 'TEMPLATE_MISSING'
              ? copy(
                'O modelo desta categoria e idioma não existe mais ou está desligado. Não dá para liberar esta mensagem: escreva o texto de novo ou descarte-a.',
                'The template for this category and language is gone or switched off. This message cannot be released: write the text again or discard it.',
              )
              : proposal.unknown.length
                ? copy(
                  `O modelo mudou e pede variáveis que não existem: ${proposal.unknown.join(', ')}. Corrija o modelo ou descarte esta mensagem — ela não pode ser liberada assim.`,
                  `The template changed and asks for variables that do not exist: ${proposal.unknown.join(', ')}. Fix the template or discard this message — it cannot be released as it is.`,
                )
                : copy(
                  'O modelo tem uma chave {{ ou }} sem par, então não dá para saber o que sairia. Corrija o modelo ou descarte esta mensagem.',
                  'The template has an unmatched {{ or }}, so there is no telling what would go out. Fix the template or discard this message.',
                )}
          </p>}
          <p className="mt-2 text-xs text-ink-muted">{copy('Criada em', 'Created')} {new Date(proposal.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</p>
        </li>
      })}
    </ul>
  </section>
}
