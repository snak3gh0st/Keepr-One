'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { KBotActivityCenter } from './KBotActivityCenter'
import { formatCredits } from '@/lib/kbot-followup/credit-display'

export type FollowupView = {
  enabled: boolean; aiAvailable: boolean; reservationPerMessage: number
  balance: { available: number; reserved: number; spent: number }
  candidates: Array<{ id: string; customerName: string; phone: string | null; reason: string; fingerprint: string; blockedReason: string | null; sourceHref: string; sourceAt: string }>
  jobs: Array<{ id: string; batchId: string; customerName: string; status: string; conversationId: string | null; content: string | null; inputTokens: number; outputTokens: number; creditState: string; billedTokens: number; reservedTokens: number; errorCode: string | null; createdAt: string }>
  catalog: { tokens: number; cents: number } | null; hasSubscription: boolean
}

export function FollowupWorkspace({ compact = false, initialData }: { compact?: boolean; initialData?: FollowupView }) {
  const { copy, locale, language } = useI18n()
  const [data, setData] = useState<FollowupView | null>(initialData ?? null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [recipientLanguage, setRecipientLanguage] = useState<'PT' | 'EN'>(language)
  const [section, setSection] = useState<'queue' | 'history'>('queue')
  const [filter, setFilter] = useState('ready')
  const [query, setQuery] = useState('')
  const [reason, setReason] = useState('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const busyRef = useRef(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'activities') {
      const timer = setTimeout(() => setSection('history'), 0)
      return () => clearTimeout(timer)
    }
  }, [])
  const request = useRef<{ selection: string; id: string } | null>(null)
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/agent/kbot/followups', { cache: 'no-store' })
      if (!response.ok) throw new Error('load')
      setData(await response.json())
    } catch { setError(copy('Não foi possível atualizar as atividades. Tente novamente.', 'Could not refresh activities. Please try again.')) }
  }, [copy])
  useEffect(() => {
    if (initialData) return
    const first = setTimeout(() => void load(), 0)
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15_000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, [load, initialData])
  const credits = (tokens: number) => formatCredits(tokens, locale)
  const reservedCredits = (tokens: number) => formatCredits(tokens, locale, true)
  const messages: Record<string, string> = {
    INSUFFICIENT_CREDITS: copy('Saldo insuficiente para a reserva. O contato manual continua disponível.', 'Insufficient balance for the reservation. Manual contact remains available.'),
    SOURCE_CHANGED: copy('Os dados mudaram. Confira a lista atualizada antes de iniciar.', 'The data changed. Check the refreshed list before starting.'),
    RECENT_CONTACT: copy('Este cliente já recebeu contato recente ou tem uma ação em andamento.', 'This customer has a recent contact or an action in progress.'),
    PHONE_REQUIRED: copy('Cadastre o telefone com código do país, começando por +.', 'Add a phone number with country code, starting with +.'),
    SYNC_REQUIRED: copy('Atualize os dados da operadora antes de usar IA.', 'Refresh carrier data before using AI.'),
    OPTED_OUT: copy('Cliente marcado para não receber contato.', 'Customer marked as opted out.'),
    CONTACT_AMBIGUOUS: copy('Este telefone aparece para mais de um cliente. Confira os cadastros antes de usar IA.', 'This phone appears for more than one customer. Check the records before using AI.'),
    SNOOZED: copy('Contato adiado. Volta à fila ao terminar o prazo de 24 horas.', 'Contact snoozed. Returns to the queue when the 24-hour period ends.'),
    WHATSAPP_DISCONNECTED: copy('Conecte seu WhatsApp na área de Mensagens.', 'Connect your WhatsApp in Messages.'),
    TEMPLATE_REQUIRED: copy('Este canal exige uma mensagem de modelo. Use o atendimento manual.', 'This channel requires a template message. Use manual contact.'),
    SEND_UNCONFIRMED: copy('Envio ainda não confirmado. A mensagem não será reenviada automaticamente.', 'Send not yet confirmed. The message will not be resent automatically.'),
    GENERATION_LIMIT: copy('Limite de geração atingido. Use o contato manual.', 'Generation limit reached. Use manual contact.'),
  }
  async function action(body: Record<string, unknown>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/agent/kbot/followups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      window.dispatchEvent(new Event('keepr-one:kbot-activity-changed'))
      if (result.href) window.location.assign(result.href)
      else {
        if (body.action === 'start') { request.current = null; setSelected({}); setNotice(copy('Follow-up iniciado. Você pode sair desta página; o K-Bot avisará o resultado.', 'Follow-up started. You can leave this page; K-Bot will notify you of the result.')) }
        if (body.action === 'phone') { setEditing(null); setPhone(''); setNotice(copy('Telefone salvo. A lista foi atualizada; selecione o contato quando estiver pronto.', 'Phone saved. The list has been refreshed; select the contact when ready.')) }
        if (body.action === 'manual') setNotice(copy('Contato manual registrado por você. A pendência continua acompanhada.', 'Manual contact recorded by you. The pending item remains tracked.'))
        await load()
      }
    } catch (e) {
      setError(messages[e instanceof Error ? e.message : ''] ?? copy('Não foi possível concluir a ação. Confira as atividades antes de tentar novamente.', 'Could not complete the action. Check activities before trying again.'))
      await load()
    } finally { busyRef.current = false; setBusy(false) }
  }
  function start(rows: FollowupView['candidates']) {
    const selection = JSON.stringify([rows.map(r => [r.id, r.fingerprint]), recipientLanguage])
    if (request.current?.selection !== selection) request.current = { selection, id: crypto.randomUUID() }
    void action({ action: 'start', requestKey: request.current.id, language: recipientLanguage,
      candidates: rows.map(r => ({ id: r.id, fingerprint: r.fingerprint })) })
  }
  if (!data) return compact ? null : <div className="rounded-2xl border border-border-steel bg-panel p-6"><p role={error ? 'alert' : 'status'}>{error || copy('Carregando atividades…', 'Loading activities…')}</p>{error && <button className="mt-3 min-h-11 underline" onClick={() => void load()}>{copy('Tentar novamente', 'Try again')}</button>}</div>
  if (!data.enabled) return compact ? null : (
    <>
    <section
      aria-label={copy('Disponibilidade do follow-up', 'Follow-up availability')}
      className="my-6 overflow-hidden rounded-3xl border border-border-steel bg-panel shadow-[var(--shadow-soft)]"
    >
      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-4 sm:flex-row sm:gap-5">
          <KBotAvatar state="idle" size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-deep">
                {copy('Follow-up do K-Bot', 'K-Bot follow-up')}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border-steel bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink-muted/60" />
                {copy('IA indisponível', 'AI unavailable')}
              </span>
            </div>
            <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
              {copy('Continue o atendimento em Mensagens', 'Continue helping customers in Messages')}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
              {copy('O follow-up com IA ainda não está disponível. Acesse suas conversas para acompanhar cada cliente pessoalmente.', 'AI follow-up is not available yet. Open your conversations to follow up with each customer personally.')}
            </p>
          </div>
        </div>
        <Link
          href="/agent/mensagens"
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-3 self-stretch rounded-xl bg-rail-strong px-5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal sm:self-start lg:self-center"
        >
          {copy('Abrir Mensagens', 'Open Messages')}
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4" focusable="false">
            <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
      <div className="flex items-center gap-2.5 border-t border-border-steel bg-teal-pale/35 px-5 py-3.5 text-xs leading-relaxed text-teal-deep sm:px-7">
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0" focusable="false">
          <path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {copy('O atendimento manual não usa créditos de IA.', 'Manual contact does not use AI credits.')}
      </div>
    </section>
    <KBotActivityCenter jobs={[]} busy={false} onCancel={() => {}} />
    </>
  )
  const eligible = data.candidates.filter(c => !c.blockedReason)
  const capacity = data.reservationPerMessage > 0 ? Math.max(0, Math.min(25, Math.floor(data.balance.available / data.reservationPerMessage))) : 0
  const selection = eligible.filter(c => selected[c.id] === c.fingerprint)
  const selectionChanged = selection.length !== Object.keys(selected).length
  const selectionAffordable = selection.length <= capacity
  const working = data.jobs.some(j => ['PENDING', 'PREPARING', 'CANCEL_REQUESTED', 'DISPATCHING', 'ACCEPTED'].includes(j.status))
  const attention = data.jobs.some(j => ['UNKNOWN', 'FAILED'].includes(j.status))
  const reasons: Record<string, string> = { LAPSED: copy('Apólice lapsada', 'Lapsed policy'), LAPSE_WARNING: copy('Risco de lapse', 'Lapse warning'), PAYMENT: copy('Aviso de pagamento', 'Payment notice'), REQUIREMENT: copy('Pendência na aplicação', 'Application requirement') }
  const group = (c: FollowupView['candidates'][number]) => !c.blockedReason ? 'ready'
    : ['PHONE_REQUIRED', 'CONTACT_AMBIGUOUS'].includes(c.blockedReason) ? 'contact'
    : c.blockedReason === 'SYNC_REQUIRED' ? 'sync' : 'paused'
  const filters = [
    { id: 'ready', label: copy('Prontos para contato', 'Ready for contact') },
    { id: 'contact', label: copy('Corrigir cadastro', 'Fix contact details') },
    { id: 'sync', label: copy('Atualizar dados', 'Refresh data') },
    { id: 'paused', label: copy('Adiados e bloqueados', 'Snoozed and blocked') },
    { id: 'all', label: copy('Todos', 'All') },
  ]
  const counts = data.candidates.reduce<Record<string, number>>((result, c) => { const key = group(c); result[key] = (result[key] ?? 0) + 1; return result }, {})
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(locale)
  const filtered = data.candidates.filter(c => (filter === 'all' || group(c) === filter) && (reason === 'all' || c.reason === reason) && normalize(c.customerName).includes(normalize(query.trim())))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25)
  const button = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:opacity-40 disabled:cursor-not-allowed'
  const secondary = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border-steel bg-panel px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-teal-pale disabled:opacity-40 disabled:cursor-not-allowed'
  const field = 'min-h-11 rounded-xl border border-border-steel bg-paper px-3 text-sm text-ink'
  function toggle(c: FollowupView['candidates'][number]) {
    setSelected(previous => { const next = { ...previous }; if (next[c.id]) delete next[c.id]; else next[c.id] = c.fingerprint; return next })
  }
  return <section className="my-4 rounded-2xl border border-border-steel bg-panel p-4 sm:p-6" aria-label={copy('Área de trabalho do K-Bot', 'K-Bot workspace')}>
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex items-center gap-3"><KBotAvatar state={working ? 'working' : attention ? 'waiting' : 'idle'} />
        <div><h2 className="text-xl font-semibold tracking-tight text-ink">{section === 'queue' ? copy('Follow-up de clientes', 'Customer follow-up') : copy('Central de atividades', 'Activity center')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{section === 'queue' ? <>{eligible.length} {copy('prontos para contato', 'ready for contact')} · {data.candidates.length - eligible.length} {copy('precisam de atenção', 'need attention')}</> : copy('Acompanhe o trabalho do K-Bot e retome o que precisa de você.', 'Track K-Bot work and resume what needs your attention.')}</p></div></div>
      <dl className="flex gap-6 text-sm tabular-nums" aria-label={copy('Créditos de IA', 'AI credits')}>
        {[{ label: copy('Disponíveis', 'Available'), value: credits(data.balance.available) }, { label: copy('Reservados', 'Reserved'), value: reservedCredits(data.balance.reserved) }, { label: copy('Utilizados', 'Used'), value: credits(data.balance.spent) }].map(item => <div key={item.label}><dt className="text-xs text-ink-muted">{item.label}</dt><dd className="mt-1 text-lg font-semibold text-ink">{item.value}</dd></div>)}
      </dl>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-teal-pale p-3 text-sm text-teal-deep">{notice}</p>}
    {compact ? <Link className={`${button} mt-4`} href="/agent/kbot">{copy('Ver ações e atividades', 'View actions and activities')}</Link> : <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-border-steel py-3">
        <nav className="flex gap-2" aria-label={copy('Áreas do K-Bot', 'K-Bot areas')}>
          <button className={section === 'queue' ? button : secondary} aria-pressed={section === 'queue'} onClick={() => setSection('queue')}>{copy('Contatos', 'Contacts')}</button>
          <button className={section === 'history' ? button : secondary} aria-pressed={section === 'history'} onClick={() => setSection('history')}>{copy('Atividades', 'Activities')}</button>
        </nav>
        <details className="text-sm text-ink-muted"><summary className="cursor-pointer py-2">{copy('Créditos e assinatura', 'Credits and subscription')}</summary>
          <div className="mt-2 max-w-lg space-y-3 pb-3 text-xs leading-relaxed">
            <p>{copy('1 crédito = 100 tokens de IA. Os valores exibidos são arredondados; a reserva usa o saldo exato.', '1 credit = 100 AI tokens. Displayed values are rounded; reservations use your exact balance.')}</p>
            <p>{copy('Os créditos são usados na geração. Uma falha posterior de envio não devolve tokens já utilizados. O atendimento manual não usa créditos de IA.', 'Credits are used for generation. A later sending failure does not refund tokens already used. Manual contact uses no AI credits.')}</p>
            {data.catalog && !data.hasSubscription && <form action="/api/billing/followup-addon/checkout" method="POST" className="flex flex-wrap items-center gap-3"><button className={secondary}>{copy('Adicionar créditos mensais', 'Add monthly credits')}</button><span>{credits(data.catalog.tokens)} {copy('créditos', 'credits')} · {new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(data.catalog.cents / 100)}/{copy('mês', 'month')}</span></form>}
            {data.hasSubscription && <form action="/api/billing/followup-addon/portal" method="POST"><button className={secondary}>{copy('Gerenciar assinatura', 'Manage subscription')}</button></form>}
            {!data.catalog && !data.hasSubscription && <p>{copy('A compra de créditos ainda não está disponível.', 'Credit purchases are not available yet.')}</p>}
          </div>
        </details>
      </div>
      {section === 'queue' ? <>
        <label className="mt-4 grid gap-1 text-xs text-ink-muted sm:hidden">{copy('Lista de contatos', 'Contact list')}<select className={field} value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}>{filters.map(item => <option key={item.id} value={item.id}>{item.label} · {item.id === 'all' ? data.candidates.length : counts[item.id] ?? 0}</option>)}</select></label>
        <nav className="mt-5 hidden flex-wrap gap-2 sm:flex" aria-label={copy('Filtrar contatos', 'Filter contacts')}>
          {filters.map(item => <button key={item.id} aria-pressed={filter === item.id} className={filter === item.id ? `${secondary} border-teal bg-teal-pale text-teal-deep` : secondary} onClick={() => { setFilter(item.id); setPage(0) }}>{item.label}<span className="ml-2 text-xs tabular-nums">{item.id === 'all' ? data.candidates.length : counts[item.id] ?? 0}</span></button>)}
        </nav>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-xs text-ink-muted">{copy('Buscar cliente', 'Search customers')}<input type="search" className={field} value={query} placeholder={copy('Nome do cliente', 'Customer name')} onChange={e => { setQuery(e.target.value); setPage(0) }} /></label>
          <label className="grid gap-1 text-xs text-ink-muted">{copy('Tipo de pendência', 'Pending item type')}<select className={field} value={reason} onChange={e => { setReason(e.target.value); setPage(0) }}><option value="all">{copy('Todas as pendências', 'All pending items')}</option>{Object.entries(reasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        <div className="mt-4 rounded-xl border border-border-steel bg-paper p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-ink-muted">{copy('Idioma das mensagens', 'Message language')}<select className={field} disabled={busy} value={recipientLanguage} onChange={e => setRecipientLanguage(e.target.value as 'PT' | 'EN')}><option value="PT">Português</option><option value="EN">English</option></select></label>
            <button className={secondary} disabled={busy || !data.aiAvailable || !capacity || !visible.some(c => !c.blockedReason)} onClick={() => setSelected(Object.fromEntries(visible.filter(c => !c.blockedReason).slice(0, capacity).map(c => [c.id, c.fingerprint])))}>{copy('Selecionar dentro do saldo', 'Select within balance')}</button>
            <button className={button} disabled={busy || !data.aiAvailable || !selection.length || selectionChanged || !selectionAffordable} onClick={() => start(selection)}>{busy ? copy('Processando…', 'Processing…') : copy('Iniciar follow-up', 'Start follow-up')} · {selection.length}</button>
            {!!Object.keys(selected).length && <button className={secondary} disabled={busy} onClick={() => setSelected({})}>{copy('Limpar seleção', 'Clear selection')}</button>}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">{copy('Selecionados:', 'Selected:')} {selection.length} · {copy('Reserva máxima:', 'Maximum reservation:')} {reservedCredits(selection.length * data.reservationPerMessage)} {copy('créditos. O saldo não utilizado é liberado.', 'credits. Unused balance is released.')}</p>
          <p className="mt-1 text-xs text-ink-muted">{copy('A seleção permanece ao mudar filtros ou páginas. O envio começa somente ao iniciar o follow-up.', 'Selection stays when changing filters or pages. Sending begins only when you start follow-up.')}</p>
          {selection.length > 0 && <details className="mt-2 text-sm text-ink"><summary className="cursor-pointer py-2">{copy('Revisar contatos selecionados', 'Review selected contacts')}</summary><ul className="mt-1 grid gap-1 sm:grid-cols-2">{selection.map(c => <li key={c.id} className="break-words text-xs text-ink-muted">{c.customerName}</li>)}</ul></details>}
          {selectionChanged && <p role="alert" className="mt-2 text-sm text-danger">{copy('Um contato selecionado mudou ou ficou indisponível. Limpe a seleção e confira os dados atualizados.', 'A selected contact changed or became unavailable. Clear the selection and review the updated data.')}</p>}
          {!selectionAffordable && <p role="alert" className="mt-2 text-sm text-danger">{messages.INSUFFICIENT_CREDITS}</p>}
          {!capacity && <p className="mt-2 text-sm text-ink-muted">{messages.INSUFFICIENT_CREDITS}</p>}
          {!data.aiAvailable && <p className="mt-2 text-sm text-ink-muted">{copy('IA indisponível no momento. O contato manual continua disponível.', 'AI is currently unavailable. Manual contact remains available.')} <Link className="underline" href="/agent/mensagens">{copy('Ver conexão do WhatsApp', 'View WhatsApp connection')}</Link></p>}
        </div>
        <div className="mt-4 divide-y divide-border-steel">
          {!visible.length && <div className="py-8 text-center"><h3 className="font-semibold text-ink">{copy('Nenhum contato nesta lista', 'No contacts in this list')}</h3><p className="mt-2 text-sm text-ink-muted">{copy('Confira os outros filtros ou ajuste a busca. Cadastros bloqueados continuam disponíveis para revisão.', 'Check other filters or adjust your search. Blocked contacts remain available for review.')}</p></div>}
          {visible.map(c => <article key={c.id} className="py-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div className="flex min-w-0 items-start gap-3">
                {!c.blockedReason && <input className="mt-1 h-5 w-5 shrink-0 accent-teal" type="checkbox" aria-label={copy('Selecionar {name}', 'Select {name}', { name: c.customerName })} checked={!!selected[c.id]} disabled={busy || !data.aiAvailable || (!selected[c.id] && selection.length >= capacity)} onChange={() => toggle(c)} />}
                <div className="min-w-0"><h3 className="break-words font-semibold text-ink">{c.customerName}</h3><p className="mt-1 text-sm text-ink-muted">{reasons[c.reason] ?? c.reason}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted"><Link className="text-teal-deep underline" href={c.sourceHref}>{copy('Ver pendência', 'View pending item')}</Link><span>{copy('Dados de', 'Data from')} {new Date(c.sourceAt).toLocaleDateString(locale)}</span></div>
                  {c.blockedReason && <p className="mt-2 max-w-xl text-xs leading-relaxed text-ink-muted">{messages[c.blockedReason] ?? copy('Revise a pendência antes de continuar.', 'Review the pending item before continuing.')}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {c.blockedReason === 'PHONE_REQUIRED' && <button className={secondary} disabled={busy} onClick={() => { setEditing(c.id); setPhone('') }}>{copy('Corrigir telefone', 'Fix phone')}</button>}
                {c.blockedReason === 'CONTACT_AMBIGUOUS' && <Link className={secondary} href={c.sourceHref}>{copy('Revisar cadastro', 'Review contact')}</Link>}
                {c.blockedReason === 'SYNC_REQUIRED' && <Link className={secondary} href="/agent/integrations/national-life">{copy('Atualizar dados', 'Refresh data')}</Link>}
                {c.phone && c.blockedReason !== 'OPTED_OUT' && <button className={secondary} disabled={busy} onClick={() => void action({ action: 'open', candidateId: c.id })}>{copy('Abrir WhatsApp', 'Open WhatsApp')}</button>}
                {!c.blockedReason && <button className={button} disabled={busy || !data.aiAvailable || !capacity} onClick={() => start([c])}>{copy('Fazer com IA', 'Use AI')} · {copy('até', 'up to')} {reservedCredits(data.reservationPerMessage)}</button>}
                <details className="relative text-sm"><summary className="min-h-11 cursor-pointer px-3 py-3 text-ink-muted">{copy('Mais', 'More')}</summary><div className="absolute right-0 z-10 grid min-w-52 gap-1 rounded-xl border border-border-steel bg-panel p-2 shadow-lg">
                  <button disabled={busy} className="min-h-11 p-2 text-left" onClick={() => void action({ action: 'manual', candidateId: c.id })}>{copy('Já fiz o contato manual', 'I contacted manually')}</button>
                  <button disabled={busy} className="min-h-11 p-2 text-left" onClick={() => void action({ action: 'snooze', candidateId: c.id })}>{copy('Adiar por 24 horas', 'Snooze for 24 hours')}</button>
                  <button disabled={busy} className="min-h-11 p-2 text-left" onClick={() => void action({ action: c.blockedReason === 'OPTED_OUT' ? 'restore' : 'optout', candidateId: c.id })}>{c.blockedReason === 'OPTED_OUT' ? copy('Permitir contato novamente', 'Allow contact again') : copy('Cliente pediu para não receber', 'Customer opted out')}</button>
                  {c.phone && c.blockedReason !== 'OPTED_OUT' && <a className="min-h-11 p-2 underline" href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">{copy('Abrir no WhatsApp externo', 'Open external WhatsApp')}</a>}
                </div></details>
              </div>
            </div>
            {editing === c.id && <form className="mt-3 rounded-xl bg-paper p-4" onSubmit={e => { e.preventDefault(); void action({ action: 'phone', candidateId: c.id, fingerprint: c.fingerprint, phone }) }}>
              <label className="grid max-w-sm gap-2 text-sm text-ink">{copy('Telefone com código do país', 'Phone with country code')}<input autoFocus required type="tel" maxLength={40} placeholder="+1 407 555 0100" className={field} value={phone} onChange={e => setPhone(e.target.value)} /></label>
              <p className="mt-2 text-xs text-ink-muted">{copy('Confirme o número com o cliente. Salvar atualiza o cadastro na Keepr One e não envia mensagem.', 'Confirm the number with the customer. Saving updates the Keepr One record and sends no message.')}</p>
              <div className="mt-3 flex gap-2"><button className={button} disabled={busy}>{copy('Salvar telefone', 'Save phone')}</button><button type="button" className={secondary} disabled={busy} onClick={() => setEditing(null)}>{copy('Cancelar', 'Cancel')}</button></div>
            </form>}
          </article>)}
        </div>
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-steel pt-4" aria-label={copy('Páginas de contatos', 'Contact pages')}>
          <p className="text-xs tabular-nums text-ink-muted">{filtered.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25, filtered.length)} {copy('de', 'of')} {filtered.length}</p>
          <div className="flex items-center gap-3"><button className={secondary} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{copy('Anterior', 'Previous')}</button><span className="text-xs tabular-nums text-ink-muted">{currentPage + 1} / {pageCount}</span><button className={secondary} disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>{copy('Próxima', 'Next')}</button></div>
        </nav>
      </> : <KBotActivityCenter jobs={data.jobs} busy={busy} onCancel={batchId => void action({ action: 'cancel', batchId })} />}
    </>}
  </section>
}
