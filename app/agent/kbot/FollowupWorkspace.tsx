'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'
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
    SNOOZED: copy('Adiado por hoje.', 'Snoozed for today.'),
    WHATSAPP_DISCONNECTED: copy('Conecte seu WhatsApp na área de Mensagens.', 'Connect your WhatsApp in Messages.'),
    TEMPLATE_REQUIRED: copy('Este canal exige uma mensagem de modelo. Use o atendimento manual.', 'This channel requires a template message. Use manual contact.'),
    SEND_UNCONFIRMED: copy('Envio ainda não confirmado. A mensagem não será reenviada automaticamente.', 'Send not yet confirmed. The message will not be resent automatically.'),
    GENERATION_LIMIT: copy('Limite de geração atingido. Use o contato manual.', 'Generation limit reached. Use manual contact.'),
  }
  async function action(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/agent/kbot/followups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if (result.href) window.location.assign(result.href)
      else {
        if (body.action === 'start') { request.current = null; setNotice(copy('Follow-up iniciado. Você pode sair desta página; o K-Bot avisará o resultado.', 'Follow-up started. You can leave this page; K-Bot will notify you of the result.')) }
        if (body.action === 'manual') setNotice(copy('Contato manual registrado por você. A pendência continua acompanhada.', 'Manual contact recorded by you. The pending item remains tracked.'))
        await load()
      }
    } catch (e) {
      setError(messages[e instanceof Error ? e.message : ''] ?? copy('Não foi possível concluir a ação. Confira as atividades antes de tentar novamente.', 'Could not complete the action. Check activities before trying again.'))
      await load()
    } finally { setBusy(false) }
  }
  function start(rows: FollowupView['candidates']) {
    const selection = JSON.stringify([rows.map(r => [r.id, r.fingerprint]), recipientLanguage])
    if (request.current?.selection !== selection) request.current = { selection, id: crypto.randomUUID() }
    void action({ action: 'start', requestKey: request.current.id, language: recipientLanguage,
      candidates: rows.map(r => ({ id: r.id, fingerprint: r.fingerprint })) })
  }
  if (!data) return compact ? null : <p role="status">{error || copy('Carregando atividades…', 'Loading activities…')}</p>
  if (!data.enabled) return compact ? null : (
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
  )
  const eligible = data.candidates.filter(c => !c.blockedReason).slice(0, 25)
  const working = data.jobs.some(j => ['PENDING', 'PREPARING', 'CANCEL_REQUESTED', 'DISPATCHING', 'ACCEPTED'].includes(j.status))
  const reasons: Record<string, string> = { LAPSED: copy('Apólice lapsed', 'Lapsed policy'), LAPSE_WARNING: copy('Risco de lapse', 'Lapse warning'), PAYMENT: copy('Aviso de pagamento', 'Payment notice'), REQUIREMENT: copy('Pendência na aplicação', 'Application requirement') }
  const states: Record<string, string> = {
    PENDING: copy('Na fila', 'Queued'), PREPARING: copy('Preparando mensagem', 'Preparing message'), DISPATCHING: copy('Enviando', 'Sending'),
    ACCEPTED: copy('Aguardando confirmação de envio', 'Awaiting send confirmation'), UNKNOWN: copy('Envio não confirmado', 'Send unconfirmed'),
    SENT: copy('Enviada', 'Sent'), DELIVERED: copy('Entregue', 'Delivered'), READ: copy('Lida', 'Read'),
    FAILED: copy('Não enviado', 'Not sent'), CANCELLED: copy('Cancelado', 'Cancelled'), CANCEL_REQUESTED: copy('Interrompendo', 'Stopping'),
  }
  const button = 'rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed'
  return <section className="my-6 rounded-3xl border border-border-steel bg-panel p-5 sm:p-7" aria-label={copy('Follow-up do K-Bot', 'K-Bot follow-up')}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-3"><KBotAvatar state={working ? 'working' : eligible.length ? 'waiting' : 'idle'} />
        <div><p className="text-xs font-semibold uppercase tracking-wider text-teal-deep">K-Bot</p>
          <h2 className="text-xl font-semibold text-ink">{copy('Clientes que precisam de atenção', 'Customers who need attention')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{copy('Escolha atender pessoalmente ou delegar o primeiro contato à IA.', 'Contact customers yourself or delegate the first outreach to AI.')}</p></div></div>
      <div className="text-sm"><strong className="text-ink">{credits(data.balance.available)} {copy('créditos disponíveis', 'credits available')}</strong>
        <p className="mt-1 text-xs text-ink-muted">{copy('1 crédito = 100 tokens de IA · valores exibidos arredondados', '1 credit = 100 AI tokens · displayed values are rounded')}</p>
        {data.balance.reserved > 0 && <p className="text-xs text-ink-muted">{reservedCredits(data.balance.reserved)} {copy('reservados', 'reserved')}</p>}</div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl bg-teal-pale p-3 text-sm text-teal-deep">{notice}</p>}
    {compact ? <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-muted">{data.candidates.length} {copy('clientes na lista de atenção', 'customers in the attention list')}</p><Link className={button} href="/agent/kbot">{copy('Ver ações e atividades', 'View actions and activities')}</Link></div> : <>
      <div className="mt-6 flex flex-wrap items-end gap-4 border-y border-border-steel py-4">
        <label className="text-sm text-ink-muted">{copy('Idioma das mensagens', 'Message language')}<select className="ml-3 rounded-lg border border-border-steel bg-panel p-2 text-ink" value={recipientLanguage} onChange={e => setRecipientLanguage(e.target.value as 'PT' | 'EN')}><option value="PT">Português</option><option value="EN">English</option></select></label>
        <button className={button} disabled={busy || !data.aiAvailable || !eligible.length || data.balance.available < eligible.length * data.reservationPerMessage} onClick={() => start(eligible)}>{copy('Sim, iniciar follow-up', 'Yes, start follow-up')} · {eligible.length}</button>
        <p className="text-xs text-ink-muted">{copy('Reserva máxima:', 'Maximum reservation:')} {reservedCredits(eligible.length * data.reservationPerMessage)} {copy('créditos. O restante volta ao saldo.', 'credits. The remainder returns to your balance.')}</p>
      </div>
      {!data.aiAvailable && <p className="mt-3 text-sm text-ink-muted">{copy('IA indisponível no momento. O contato manual continua disponível.', 'AI is currently unavailable. Manual contact remains available.')} <Link className="underline" href="/agent/mensagens">{copy('Ver conexão do WhatsApp', 'View WhatsApp connection')}</Link></p>}
      <p className="mt-3 text-xs text-ink-muted">{copy('Os créditos são usados na geração. Uma falha posterior de envio não devolve tokens já utilizados. Não há cobrança por abrir a conversa ou enviar manualmente.', 'Credits are used for generation. A later sending failure does not refund tokens already used. Opening a conversation or sending manually uses no AI credits.')}</p>
      {data.catalog && !data.hasSubscription && <form action="/api/billing/followup-addon/checkout" method="POST" className="mt-4 flex flex-wrap items-center gap-3"><button className="rounded-xl border border-teal px-4 py-2 text-sm font-semibold text-teal-deep">{copy('Adicionar créditos mensais', 'Add monthly credits')}</button><span className="text-sm text-ink-muted">{credits(data.catalog.tokens)} {copy('créditos', 'credits')} · {new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(data.catalog.cents / 100)}/{copy('mês', 'month')}</span></form>}
      {data.hasSubscription && <form action="/api/billing/followup-addon/portal" method="POST" className="mt-4"><button className="text-sm underline">{copy('Gerenciar assinatura', 'Manage subscription')}</button></form>}
      {!data.catalog && <p className="mt-3 text-xs text-ink-muted">{copy('A compra de créditos ainda não está disponível.', 'Credit purchases are not available yet.')}</p>}
      <div className="mt-5 divide-y divide-border-steel">
        {!data.candidates.length && <p className="py-6 text-sm text-ink-muted">{copy('Nenhuma pendência identificada nos dados disponíveis.', 'No pending items identified in the available data.')}</p>}
        {data.candidates.map(c => <article key={c.id} className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="min-w-0"><h3 className="font-semibold text-ink">{c.customerName}</h3><p className="text-sm text-ink-muted">{reasons[c.reason]}</p>
            <Link className="text-xs text-teal-deep underline" href={c.sourceHref}>{copy('Ver pendência', 'View pending item')}</Link>
            <p className="mt-1 text-xs text-ink-muted">{copy('Dados de', 'Data from')} {new Date(c.sourceAt).toLocaleDateString(locale)}</p>
            {c.blockedReason && <p className="mt-1 text-xs text-ink-muted">{messages[c.blockedReason] ?? c.blockedReason}</p>}</div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-xl border border-border-steel px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40" disabled={busy || !c.phone || c.blockedReason === 'OPTED_OUT'} onClick={() => void action({ action: 'open', candidateId: c.id })}>{copy('Abrir WhatsApp', 'Open WhatsApp')}</button>
            <button className={button} disabled={busy || !!c.blockedReason || !data.aiAvailable || data.balance.available < data.reservationPerMessage} onClick={() => start([c])}>{copy('Fazer com IA', 'Use AI')} · {copy('até', 'up to')} {reservedCredits(data.reservationPerMessage)}</button>
            <details className="relative text-sm"><summary className="cursor-pointer px-3 py-2 text-ink-muted">{copy('Mais', 'More')}</summary><div className="absolute right-0 z-10 grid min-w-52 gap-1 rounded-xl border border-border-steel bg-panel p-2 shadow-lg">
              <button disabled={busy} className="p-2 text-left" onClick={() => void action({ action: 'manual', candidateId: c.id })}>{copy('Já fiz o contato manual', 'I contacted manually')}</button>
              <button disabled={busy} className="p-2 text-left" onClick={() => void action({ action: 'snooze', candidateId: c.id })}>{copy('Agora não — adiar', 'Not now — snooze')}</button>
              <button disabled={busy} className="p-2 text-left" onClick={() => void action({ action: c.blockedReason === 'OPTED_OUT' ? 'restore' : 'optout', candidateId: c.id })}>{c.blockedReason === 'OPTED_OUT' ? copy('Permitir contato novamente', 'Allow contact again') : copy('Cliente pediu para não receber', 'Customer opted out')}</button>
              {c.phone && c.blockedReason !== 'OPTED_OUT' && <a className="p-2 underline" href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">{copy('Abrir no WhatsApp externo', 'Open external WhatsApp')}</a>}
            </div></details>
          </div>
        </article>)}
      </div>
      <div className="mt-8 border-t border-border-steel pt-6"><h2 className="text-lg font-semibold text-ink">{copy('Atividades do K-Bot', 'K-Bot activities')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{copy('O processamento continua em segundo plano. Enviar uma mensagem não resolve automaticamente a pendência.', 'Processing continues in the background. Sending a message does not automatically resolve the pending item.')}</p>
        {!data.jobs.length && <p className="mt-4 text-sm text-ink-muted">{copy('Nenhuma execução ainda.', 'No executions yet.')}</p>}
        {data.jobs.map(j => <article key={j.id} className="mt-3 rounded-xl border border-border-steel p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm text-ink">{j.customerName}</strong><span className="text-sm text-ink-muted">{states[j.status] ?? j.status}</span></div>
          <p className="mt-1 text-xs text-ink-muted">{j.creditState === 'RESERVED' ? `${reservedCredits(j.reservedTokens)} ${copy('créditos reservados', 'credits reserved')}` : `${credits(j.billedTokens)} ${copy('créditos utilizados', 'credits used')}`}</p>
          {j.errorCode && <p className="mt-2 text-xs text-ink-muted">{messages[j.errorCode] ?? copy('Ação não concluída. Consulte a conversa ou realize o contato manual.', 'Action not completed. Check the conversation or contact manually.')}</p>}
          {j.content && <details className="mt-2 text-sm text-ink-muted"><summary className="cursor-pointer">{copy('Ver mensagem preparada', 'View prepared message')}</summary><p className="mt-2">{j.content}</p></details>}
          <div className="mt-2 flex gap-4 text-sm">{j.conversationId && <Link className="text-teal-deep underline" href={`/agent/mensagens?conversation=${j.conversationId}`}>{copy('Abrir conversa', 'Open conversation')}</Link>}
            {['PENDING', 'PREPARING'].includes(j.status) && <button disabled={busy} className="text-ink-muted underline" onClick={() => void action({ action: 'cancel', batchId: j.batchId })}>{copy('Interromper próximos envios deste lote', 'Stop next sends in this batch')}</button>}</div>
        </article>)}
      </div>
    </>}
  </section>
}
