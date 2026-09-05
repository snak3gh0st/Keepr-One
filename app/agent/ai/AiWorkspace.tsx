'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KBotAvatar } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { formatCredits } from '@/lib/kbot-followup/credit-display'
import { ATTENTION_STATUSES, CONFIRMED_STATUSES, WORKING_STATUSES, type AiActivity, type AiFilter, type AiOverviewResponse, type AiPeriod } from '@/lib/kbot-ai/overview'
import styles from './ai.module.css'

export function AiWorkspace({ initialData }: { initialData?: AiOverviewResponse }) {
  const { copy, locale } = useI18n()
  const [data, setData] = useState<AiOverviewResponse | null>(initialData ?? null)
  const [period, setPeriod] = useState<AiPeriod>(initialData?.enabled ? initialData.period : 'month')
  const [filter, setFilter] = useState<AiFilter>('all')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let alive = true
    let pending = false
    const controller = new AbortController()
    const update = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const response = await fetch(`/api/agent/ai?period=${period}&filter=${filter}&page=${page}`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('UNAVAILABLE')
        const next: AiOverviewResponse = await response.json()
        if (alive) { setData(next); setError(false) }
      } catch { if (alive) setError(true) }
      finally { pending = false; if (alive) setLoading(false) }
    }
    void update()
    const timer = setInterval(() => void update(), 15_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { alive = false; controller.abort(); clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [period, filter, page, refresh])
  const reload = useCallback(() => { setLoading(true); setRefresh(n => n + 1) }, [])
  async function cancel(batchId: string) {
    if (busy) return
    setBusy(batchId); setActionError(false); setNotice('')
    try {
      const response = await fetch('/api/agent/kbot/followups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', batchId }) })
      if (!response.ok) throw new Error('UNAVAILABLE')
      if (mounted.current) {
        setNotice(copy('Interrupção solicitada. Mensagens já enviadas permanecem na conversa.', 'Stop requested. Messages already sent remain in the conversation.'))
        reload()
      }
    } catch { if (mounted.current) setActionError(true) }
    finally { if (mounted.current) setBusy(null) }
  }
  const credits = (tokens: number, reserved = false) => tokens > 0 && tokens < 50 && !reserved ? '<1' : formatCredits(tokens, locale, reserved)
  const date = (value: string, time = false) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'UTC' }).format(new Date(value))
  const overview = data?.enabled ? data : null
  // Keep the previous snapshot visible on refresh errors, together with its own selected period.
  const displayedPeriod = overview?.period ?? period
  const periodNames = { month: copy('Este mês', 'This month'), '7d': copy('Últimos 7 dias', 'Last 7 days'), '30d': copy('Últimos 30 dias', 'Last 30 days') }
  const state = !overview ? 'idle' : overview.current.unconfirmed > 0 ? 'waiting' : overview.current.working > 0 && overview.availability === 'READY' ? 'working' : overview.availability !== 'READY' ? 'waiting' : 'idle'
  const status = !overview ? copy('Consultando sua atividade', 'Checking your activity')
    : overview.current.unconfirmed > 0 ? copy('Vamos conferir uma entrega.', 'Let’s check a delivery.')
      : overview.availability === 'AI_DISABLED' ? copy('AI pausada no momento.', 'AI is currently paused.')
        : overview.availability === 'CHANNEL_UNAVAILABLE' ? copy('Conecte seu WhatsApp.', 'Connect your WhatsApp.')
          : overview.current.working > 0 ? copy('Cuidando dos seus contatos.', 'Taking care of your contacts.') : copy('Pronto para sua próxima ação.', 'Ready for your next action.')
  const statusDetail = !overview ? '' : overview.current.unconfirmed > 0
    ? copy(overview.current.unconfirmed === 1 ? 'Um envio aguarda confirmação. Confira a conversa antes de um novo contato.' : '{count} envios aguardam confirmação. Confira as conversas antes de novos contatos.', overview.current.unconfirmed === 1 ? 'One send awaits confirmation. Check the conversation before contacting again.' : '{count} sends await confirmation. Check the conversations before contacting again.', { count: overview.current.unconfirmed })
    : overview.availability === 'AI_DISABLED' ? copy('Você pode consultar seu histórico e continuar o atendimento manual.', 'You can review your history and continue contacting clients manually.')
      : overview.availability === 'CHANNEL_UNAVAILABLE' ? copy('O canal precisa estar conectado para iniciar contatos com AI.', 'Your channel needs to be connected to start AI follow-ups.')
        : overview.current.working > 0 ? copy(overview.current.working === 1 ? 'Uma ação na fila ou em andamento. Acompanhe cada etapa abaixo.' : '{count} ações na fila ou em andamento. Acompanhe cada etapa abaixo.', overview.current.working === 1 ? 'One action queued or in progress. Follow every step below.' : '{count} actions queued or in progress. Follow every step below.', { count: overview.current.working })
          : copy('Você escolhe os contatos. Eu executo o que você autorizar e mostro o resultado.', 'You choose the contacts. I carry out what you authorize and show the result.')

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{copy('Seu centro de controle', 'Your control center')}</p><h1>K-Bot <span>AI</span></h1><p>{copy('O que fez. O que consumiu. O que vem agora.', 'What it did. What it used. What comes next.')}</p></div>
      <div className={styles.period}><label htmlFor="ai-period">{copy('Período', 'Period')}</label><select id="ai-period" value={period} onChange={event => { setPeriod(event.target.value as AiPeriod); setPage(0); setLoading(true) }}>{Object.entries(periodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className={styles.iconButton} onClick={reload} disabled={loading} aria-label={copy('Atualizar painel', 'Refresh dashboard')}>↻</button></div>
    </header>
    {error && <div role="alert" className={styles.alert}>{copy('Não foi possível atualizar o painel. Os dados exibidos são da última consulta.', 'Could not refresh the dashboard. Displayed data is from the last check.')} <button onClick={reload}>{copy('Tentar novamente', 'Try again')}</button></div>}
    {!data && !error && <p role="status" className={styles.empty}>{copy('Consultando atividade e créditos…', 'Checking activity and credits…')}</p>}
    {data && !data.enabled && <section className={styles.empty}><KBotAvatar size="lg" /><h2>{copy('Seu centro AI está em preparação.', 'Your AI center is being prepared.')}</h2><p>{copy('Assim que o recurso estiver disponível, suas ações e créditos aparecerão aqui.', 'Once this feature is available, your actions and credits will appear here.')}</p><Link className={styles.button} href="/agent/kbot">{copy('Abrir K-Bot', 'Open K-Bot')}</Link></section>}
    {overview && <>
      <section className={styles.cockpit} aria-label={copy('Status e saldo de AI', 'AI status and balance')}>
        <div className={styles.pilot} data-state={state}>
          <div className={styles.pilotTop}><span className={styles.live}><i />{copy('Sob seu comando', 'Under your control')}</span><span>KEEPR ONE</span></div>
          <div className={styles.instrument} aria-hidden="true"><div className={styles.orbit} /><div className={styles.orbitInner} /><div className={styles.crosshair} /><div className={styles.avatar}><KBotAvatar state={state} size="lg" /></div><span className={styles.instrumentLabel}>K-BOT / AI</span></div>
          <div className={styles.pilotMessage}><p className={styles.eyebrow}>{copy('Agora', 'Now')}</p><h2>{status}</h2><p>{statusDetail}</p></div>
          <div className={styles.pilotFooter}><Link href="/agent/kbot">{copy('Escolher próxima ação', 'Choose next action')} <span aria-hidden="true">↗</span></Link><span>{copy('Autorização por ação', 'Per-action authorization')}</span></div>
        </div>
        <div className={styles.wallet}>
          <p className={styles.eyebrow}>{copy('Sua autonomia', 'Your available capacity')}</p>
          <div className={styles.balance}><strong>{credits(overview.balance.available)}</strong><span>{copy('créditos disponíveis', 'credits available')}</span></div>
          <div className={styles.meter} role="meter" aria-label={copy('Saldo disponível dos créditos válidos', 'Available balance of valid credits')} aria-valuenow={overview.balance.available} aria-valuemin={0} aria-valuemax={Math.max(1, overview.balance.allowance)} aria-valuetext={`${credits(overview.balance.available)} ${copy('créditos disponíveis', 'credits available')}`}><span style={{ width: `${overview.balance.allowance ? Math.min(100, overview.balance.available / overview.balance.allowance * 100) : 0}%` }} /></div>
          <dl className={styles.walletRows}><div><dt>{copy('Reservados em tarefas', 'Reserved for tasks')}</dt><dd>{credits(overview.balance.reserved, true)}</dd></div><div><dt>{copy('Máximo por contato', 'Maximum per contact')}</dt><dd>{copy('Até {count} créditos', 'Up to {count} credits', { count: credits(overview.reservationPerMessage, true) })}</dd></div></dl>
          <p className={styles.walletNote}>{overview.balance.expiresAt ? copy('Próximo vencimento de saldo: {date} (UTC).', 'Next balance expiration: {date} (UTC).', { date: date(overview.balance.expiresAt) }) : copy('Nenhum saldo livre com vencimento futuro.', 'No available balance with a future expiration.')}</p>
          <div className={styles.spend}><div><p>{copy('Consumidos no período', 'Used in this period')}</p><strong>{credits(overview.consumption.tokens)} <small>{credits(overview.consumption.tokens) === '1' ? copy('crédito', 'credit') : copy('créditos', 'credits')}</small></strong></div><span>{periodNames[displayedPeriod]}</span></div>
          <p className={styles.walletNote}>{copy('As reservas limitam o gasto de cada ação. O saldo não utilizado é liberado.', 'Reservations cap each action’s spend. Unused balance is released.')}</p>
        </div>
      </section>

      <section className={styles.impact} aria-label={copy('Resultados confirmados', 'Confirmed results')}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{copy('Impacto visível', 'Visible impact')}</p><h2>{copy('Cada contato, um passo adiante.', 'Every contact, a step forward.')}</h2></div><span>{periodNames[displayedPeriod]}</span></div>
        <dl className={styles.metrics}>{[
          [copy('Envios confirmados', 'Confirmed sends'), overview.impact.sent, copy('Aceitos pelo provedor de envio', 'Accepted by the sending provider')],
          [copy('Mensagens entregues', 'Messages delivered'), overview.impact.delivered, copy('Entrega confirmada ao destinatário', 'Delivery to the recipient confirmed')],
          [copy('Leituras confirmadas', 'Confirmed reads'), overview.impact.read, copy('Com confirmação de leitura recebida', 'With a received read receipt')],
        ].map(([label, value, detail], index) => <div key={label}><dt><span>0{index + 1}</span>{label}</dt><dd>{Number(value).toLocaleString(locale)}</dd><p>{detail}</p></div>)}</dl>
        <p className={styles.footnote}>{copy('Resultados atuais das ações iniciadas no período (UTC). Leituras também contam como entregas e envios. Uma entrega ainda não confirma resposta ou recuperação da apólice.', 'Current results for actions started in the period (UTC). Reads also count as deliveries and sends. Delivery does not yet confirm a reply or policy recovery.')}</p>
      </section>

      <section className={styles.history} aria-label={copy('Histórico de AI', 'AI history')}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{copy('Transparência em cada ação', 'Transparency in every action')}</p><h2>{copy('Atividade & consumo', 'Activity & usage')}</h2></div><span>{overview.consumption.generations.toLocaleString(locale)} {copy('gerações com AI no período', 'AI generations in the period')}</span></div>
        <div className={styles.historyToolbar}><nav aria-label={copy('Filtrar atividade de AI', 'Filter AI activity')}>{([['all', copy('Todas', 'All')], ['working', copy('Em andamento', 'In progress')], ['attention', copy('Precisa de atenção', 'Needs attention')], ['completed', copy('Finalizadas', 'Finished')]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); setLoading(true) }}>{label}</button>)}</nav><span aria-live="polite">{loading ? copy('Atualizando…', 'Refreshing…') : copy('Atualizado às {time} UTC', 'Updated at {time} UTC', { time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(overview.updatedAt)) })}</span></div>
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
        {actionError && <p role="alert" className={styles.alert}>{copy('Não foi possível solicitar a interrupção. Tente novamente.', 'Could not request a stop. Try again.')}</p>}
        <div className={styles.rows} aria-busy={loading}>{overview.activity.jobs.map(job => <Activity key={job.id} job={job} busy={!!busy || loading || error} onCancel={cancel} credits={credits} date={date} />)}</div>
        {!overview.activity.jobs.length && <div className={styles.empty}><h3>{copy('Nenhuma atividade neste filtro.', 'No activity in this filter.')}</h3><p>{copy('Quando você autorizar um contato com AI, as etapas e o consumo aparecerão aqui.', 'When you authorize an AI follow-up, its steps and usage will appear here.')}</p><Link className={styles.button} href="/agent/kbot">{copy('Ver contatos disponíveis', 'View available contacts')}</Link></div>}
        <footer className={styles.pagination}><span>{copy('{count} atividades', '{count} activities', { count: overview.activity.total.toLocaleString(locale) })} · {copy('Página', 'Page')} {overview.activity.page + 1} / {Math.max(1, Math.ceil(overview.activity.total / overview.activity.pageSize))}</span><div><button disabled={loading || overview.activity.page === 0} onClick={() => { setPage(overview.activity.page - 1); setLoading(true) }}>{copy('Anterior', 'Previous')}</button><button disabled={loading || (overview.activity.page + 1) * overview.activity.pageSize >= overview.activity.total} onClick={() => { setPage(overview.activity.page + 1); setLoading(true) }}>{copy('Próxima', 'Next')}</button></div></footer>
      </section>

      <section className={styles.controls} aria-label={copy('Consumo e cobrança', 'Usage and billing')}>
        <div><p className={styles.eyebrow}>{copy('Regras claras', 'Clear rules')}</p><h2>{copy('Você decide até onde ir.', 'You decide how far to go.')}</h2><p>{copy('Os créditos são consumidos ao gerar a mensagem, mesmo se o envio falhar depois. Atendimento manual não consome AI.', 'Credits are used when generating the message, even if sending fails later. Manual contact uses no AI credits.')}</p><details><summary>{copy('Como o consumo é calculado', 'How usage is calculated')}</summary><p>{copy('1 crédito = 100 tokens. Exibimos créditos inteiros; valores positivos abaixo de meio crédito aparecem como <1. O cálculo usa o saldo exato. Reservas e limites são arredondados para cima. O consumo do período considera o início da geração (UTC); o saldo considera apenas créditos ainda válidos.', '1 credit = 100 tokens. We display whole credits; positive amounts below half a credit appear as <1. Calculations use the exact balance. Reservations and limits round up. Period usage follows generation start time (UTC); balance includes only unexpired credits.')}</p></details></div>
        <div className={styles.billing}><p className={styles.eyebrow}>{copy('Plano de créditos', 'Credit plan')}</p>{overview.subscription ? <><strong>{new Intl.NumberFormat(locale, { style: 'currency', currency: overview.subscription.currency }).format(overview.subscription.cents / 100)} <small>/{copy('mês', 'month')}</small></strong><p>{copy('Preço do plano. O consumo acima é medido em créditos.', 'Plan price. Usage above is measured in credits.')}</p>{overview.subscription.status === 'PAST_DUE' && <p>{copy('Há uma pendência na assinatura.', 'Your subscription has a payment issue.')}</p>}{overview.subscription.periodEnd && <p>{overview.subscription.cancelAtPeriodEnd ? copy('Encerramento previsto: {date} (UTC)', 'Scheduled end: {date} (UTC)', { date: date(overview.subscription.periodEnd) }) : copy('Fim do ciclo atual: {date} (UTC)', 'Current cycle ends: {date} (UTC)', { date: date(overview.subscription.periodEnd) })}</p>}<form action="/api/billing/followup-addon/portal" method="POST"><button className={styles.button}>{copy('Ver assinatura e faturas', 'View subscription and invoices')}</button></form></> : <><strong>{copy('Créditos da conta', 'Account credits')}</strong><p>{copy('Nenhum plano mensal de AI vinculado. Consulte o K-Bot para ver as opções de créditos.', 'No monthly AI plan linked. Open K-Bot to see credit options.')}</p><Link className={styles.button} href="/agent/kbot">{copy('Gerenciar créditos', 'Manage credits')}</Link></>}</div>
      </section>
    </>}
  </div>
}

function Activity({ job, busy, onCancel, credits, date }: { job: AiActivity; busy: boolean; onCancel: (batchId: string) => void; credits: (tokens: number, reserved?: boolean) => string; date: (value: string, time?: boolean) => string }) {
  const { copy } = useI18n()
  const labels: Record<string, string> = {
    PENDING: copy('Na fila', 'Queued'), PREPARING: copy('Preparando', 'Preparing'), DISPATCHING: copy('Enviando', 'Sending'), ACCEPTED: copy('Aguardando confirmação', 'Awaiting confirmation'), UNKNOWN: copy('Envio não confirmado', 'Send unconfirmed'),
    SENT: copy('Enviada', 'Sent'), DELIVERED: copy('Entregue', 'Delivered'), READ: copy('Lida', 'Read'), FAILED: copy('Precisa de revisão', 'Needs review'), CANCELLED: copy('Cancelada', 'Cancelled'), CANCEL_REQUESTED: copy('Interrompendo', 'Stopping'),
  }
  const reasons: Record<string, string> = { LAPSED: copy('Apólice encerrada', 'Lapsed policy'), LAPSE_WARNING: copy('Risco de encerramento', 'Lapse warning'), PAYMENT: copy('Pendência de pagamento', 'Payment follow-up'), REQUIREMENT: copy('Pendência documental', 'Document follow-up') }
  const reserved = job.creditState === 'RESERVED'
  const generated = job.creditState === 'SPENT' || !!job.content
  const consumed = job.creditState === 'SPENT'
  const sent = CONFIRMED_STATUSES.includes(job.status)
  const delivered = ['DELIVERED', 'READ'].includes(job.status)
  const tone = ATTENTION_STATUSES.includes(job.status) ? 'attention' : WORKING_STATUSES.includes(job.status) ? 'working' : 'done'
  return <article className={styles.activity}>
    <details><summary className={styles.activitySummary}><span className={styles.activityIcon} data-tone={tone} aria-hidden="true">{delivered ? '✓' : tone === 'attention' ? '!' : '↗'}</span><span className={styles.activityName}><strong>{job.customerName}</strong><span>{reasons[job.reason] ?? copy('Contato', 'Follow-up')} · {date(job.createdAt, true)} UTC</span></span><span className={styles.status} data-tone={tone}>{labels[job.status] ?? copy('Confira os detalhes', 'Check details')}</span><span className={styles.activityCost}><strong>{credits(reserved ? job.reservedTokens : job.billedTokens, reserved)}</strong><span>{reserved ? copy('créditos reservados', 'credits reserved') : credits(job.billedTokens) === '1' ? copy('crédito utilizado', 'credit used') : copy('créditos utilizados', 'credits used')}</span></span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
      <div className={styles.activityDetails}><p className={styles.aiLabel}>{consumed ? copy('Com consumo de AI', 'AI usage recorded') : reserved ? copy('AI autorizada · consumo ainda não registrado', 'AI authorized · no usage recorded yet') : copy('Sem consumo de AI', 'No AI usage')}</p>
        <ol className={styles.steps}>{[[copy('Autorizada', 'Authorized'), true], [copy('Mensagem preparada', 'Message prepared'), !!job.content], [copy('Envio confirmado', 'Send confirmed'), sent], [copy('Entrega confirmada', 'Delivery confirmed'), delivered]].map(([label, done]) => <li key={String(label)} data-done={done}><span aria-hidden="true">{done ? '✓' : '·'}</span>{label}</li>)}</ol>
        {job.status === 'UNKNOWN' && <p className={styles.alert}>{copy('A entrega ainda não foi confirmada. O K-Bot não repetirá esse envio automaticamente. Confira a conversa.', 'Delivery has not been confirmed. K-Bot will not repeat this send automatically. Check the conversation.')}</p>}
        {job.status === 'FAILED' && <p>{generated ? copy('A ação falhou após o início da geração. Créditos já utilizados permanecem consumidos.', 'The action failed after generation started. Credits already used remain consumed.') : copy('A ação não foi concluída. Confira o cadastro e a conexão antes de um novo contato.', 'The action was not completed. Check contact details and the connection before trying again.')}</p>}
        {job.content && <blockquote>{job.content}</blockquote>}
        <div className={styles.activityActions}>{job.conversationId && <Link className={styles.button} href={`/agent/mensagens?conversation=${encodeURIComponent(job.conversationId)}`}>{copy('Abrir conversa', 'Open conversation')} ↗</Link>}{['PENDING', 'PREPARING'].includes(job.status) && <button className={styles.button} disabled={busy} onClick={() => onCancel(job.batchId)}>{copy('Interromper lote', 'Stop batch')}</button>}</div>
        {['PENDING', 'PREPARING'].includes(job.status) && <p className={styles.footnote}>{copy('Interrompe as mensagens ainda pendentes deste mesmo lote. Uma geração já iniciada pode consumir créditos.', 'Stops messages still pending in this batch. Generation already started may use credits.')}</p>}
      </div>
    </details>
  </article>
}
