'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { carrierActivities, followupActivityGroup, type ActivityGroup, type CarrierActivitySnapshot } from '@/lib/kbot/activities'
import { formatCredits } from '@/lib/kbot-followup/credit-display'
import type { FollowupView } from './FollowupWorkspace'

type Props = {
  jobs: FollowupView['jobs']; busy: boolean; onCancel: (batchId: string) => void
  initialCarrier?: CarrierActivitySnapshot
}

export function KBotActivityCenter({ jobs, busy, onCancel, initialCarrier }: Props) {
  const { copy, locale } = useI18n()
  const [snapshot, setSnapshot] = useState<CarrierActivitySnapshot | null>(initialCarrier ?? null)
  const [unavailable, setUnavailable] = useState(false)
  const [group, setGroup] = useState<ActivityGroup | 'all'>('all')
  const [page, setPage] = useState(0)
  const [refreshId, setRefreshId] = useState(0)
  useEffect(() => {
    if (initialCarrier) return
    let alive = true
    let pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (pending || document.visibilityState !== 'visible') return
      pending = true
      try {
        const response = await fetch('/api/agent/carrier-sync', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('UNAVAILABLE')
        const next: CarrierActivitySnapshot = await response.json()
        if (alive) { setSnapshot(next); setUnavailable(false) }
      } catch { if (alive) setUnavailable(true) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false; controller.abort(); clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [initialCarrier, refreshId])
  const retry = useCallback(() => setRefreshId(value => value + 1), [])
  const labels: Record<string, string> = {
    COMPLETED: copy('Dados atualizados', 'Data updated'), PARTIAL: copy('Atualização parcial', 'Partial update'), PAUSED: copy('Precisa da sua atenção', 'Needs your attention'),
    RUNNING: copy('Em andamento', 'In progress'), QUEUED: copy('Na fila', 'Queued'), UNKNOWN: copy('Ainda não confirmado', 'Not yet confirmed'),
    WORKING: copy('Em andamento', 'In progress'), NEEDS_YOU: copy('Precisa do seu login', 'Needs your sign-in'), NEEDS_KBOT: copy('Reconecte este computador', 'Reconnect this computer'),
    READY: copy('Resultado disponível', 'Result available'), FAILED: copy('Precisa de revisão', 'Needs review'), CANCELLED: copy('Cancelado', 'Cancelled'),
    PENDING: copy('Na fila', 'Queued'), PREPARING: copy('Preparando mensagem', 'Preparing message'), DISPATCHING: copy('Enviando', 'Sending'),
    ACCEPTED: copy('Aguardando confirmação de envio', 'Awaiting send confirmation'), SENT: copy('Enviada', 'Sent'), DELIVERED: copy('Entregue', 'Delivered'), READ: copy('Lida', 'Read'), CANCEL_REQUESTED: copy('Interrompendo', 'Stopping'),
  }
  const operationNames = { sync: copy('Sincronização National Life', 'National Life sync'), illustration: copy('Ilustração oficial', 'Official illustration'), application: copy('Aplicação no iGO', 'iGO application') }
  const operations = snapshot ? carrierActivities(snapshot) : []
  const all = [
    ...operations.map(operation => ({ id: operation.id, group: operation.group, at: operation.at, operation, job: null })),
    ...jobs.map(job => ({ id: `followup:${job.id}`, group: followupActivityGroup(job.status), at: job.createdAt, operation: null, job })),
  ]
  const rank = { attention: 0, working: 1, history: 2 }
  all.sort((a, b) => rank[a.group] - rank[b.group] || (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0))
  const filtered = all.filter(row => group === 'all' || row.group === group)
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pages - 1)
  const button = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-border-steel bg-panel px-3 py-2 text-sm font-medium text-ink disabled:opacity-40'
  const filters = [
    { id: 'all', label: copy('Todas', 'All') }, { id: 'attention', label: copy('Precisa de você', 'Needs you') },
    { id: 'working', label: copy('Em andamento', 'In progress') }, { id: 'history', label: copy('Histórico', 'History') },
  ] as const
  return <section className="pt-5" aria-label={copy('Central de atividades do K-Bot', 'K-Bot activity center')}>
    <h2 className="text-lg font-semibold text-ink">{copy('Operações recentes', 'Recent operations')}</h2>
    {unavailable ? <div role="alert" className="mt-4 rounded-xl bg-gold-pale p-3 text-sm text-ink"><p>{copy('Não foi possível atualizar as operações da National Life. A última informação conhecida foi mantida.', 'Could not refresh National Life operations. The last known information has been kept.')}</p><button className={`${button} mt-2`} onClick={retry}>{copy('Tentar novamente', 'Try again')}</button></div>
      : !snapshot && <p role="status" className="mt-4 text-sm text-ink-muted">{copy('Consultando operações da National Life…', 'Checking National Life operations…')}</p>}
    <nav className="my-4 flex flex-wrap gap-2" aria-label={copy('Filtrar atividades', 'Filter activities')}>
      {filters.map(item => <button key={item.id} aria-pressed={group === item.id} className={`${button} ${group === item.id ? 'border-teal bg-teal-pale text-teal-deep' : ''}`} onClick={() => { setGroup(item.id); setPage(0) }}>{item.label} · {item.id === 'all' ? all.length : all.filter(row => row.group === item.id).length}</button>)}
    </nav>
    {!filtered.length && <p className="py-6 text-sm text-ink-muted">{copy('Nenhuma atividade neste filtro.', 'No activities in this filter.')}</p>}
    <div className="space-y-3">{filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(row => {
      const { operation, job } = row
      const status = operation?.status ?? job!.status
      const title = operation ? operationNames[operation.kind] : job!.customerName
      const href = operation?.href ?? (job?.conversationId ? `/agent/mensagens?conversation=${job.conversationId}` : null)
      const isReserved = job?.creditState === 'RESERVED'
      const credits = job ? formatCredits(isReserved ? job.reservedTokens : job.billedTokens, locale, isReserved) : null
      const statusLabel = job?.status === 'UNKNOWN' ? copy('Envio não confirmado', 'Send unconfirmed') : labels[status] ?? copy('Confira os detalhes', 'Check details')
      return <article key={row.id} className="rounded-xl border border-border-steel p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs text-ink-muted">{operation ? copy('National Life', 'National Life') : copy('Follow-up', 'Follow-up')}</p><h3 className="mt-1 break-words text-sm font-semibold text-ink">{title}</h3></div><span className={`rounded-lg px-2 py-1 text-xs font-medium ${row.group === 'attention' ? 'bg-gold-pale text-gold-ink' : row.group === 'working' ? 'bg-teal-pale text-teal-deep' : 'bg-paper text-ink-muted'}`}>{statusLabel}</span></div>
        {row.at && <p className="mt-2 text-xs text-ink-muted">{new Date(row.at).toLocaleString(locale)}</p>}
        {operation?.progress && <p className="mt-2 text-sm text-ink-muted">{copy('{completed} de {total} áreas verificadas', '{completed} of {total} areas checked', operation.progress)}</p>}
        {operation?.status === 'NEEDS_YOU' && <p className="mt-2 text-sm text-ink-muted">{copy('Entre na National Life para continuar a mesma operação.', 'Sign in to National Life to continue the same operation.')}</p>}
        {operation?.status === 'NEEDS_KBOT' && <p className="mt-2 text-sm text-ink-muted">{copy('Reconecte o K-Bot neste computador para continuar a solicitação.', 'Reconnect K-Bot on this computer to continue the request.')}</p>}
        {job && <p className="mt-2 text-xs text-ink-muted">{credits} {isReserved ? credits === '1' ? copy('crédito reservado', 'credit reserved') : copy('créditos reservados', 'credits reserved') : credits === '1' ? copy('crédito utilizado', 'credit used') : copy('créditos utilizados', 'credits used')}</p>}
        {job?.status === 'UNKNOWN' && <p className="mt-2 text-xs text-ink-muted">{copy('A mensagem não será reenviada automaticamente. Confira a conversa antes de fazer um novo contato.', 'The message will not be resent automatically. Check the conversation before making another contact.')}</p>}
        {job?.errorCode && job.status !== 'UNKNOWN' && <p className="mt-2 text-xs text-ink-muted">{copy('Ação não concluída. Consulte a conversa ou realize o contato manual.', 'Action not completed. Check the conversation or contact manually.')}</p>}
        {job?.content && <details className="mt-2 text-sm text-ink-muted"><summary className="cursor-pointer py-2">{copy('Ver mensagem preparada', 'View prepared message')}</summary><p className="mt-2 whitespace-pre-wrap">{job.content}</p></details>}
        <div className="mt-2 flex flex-wrap gap-3">{href && <Link className={button} href={href}>{job ? copy('Abrir conversa', 'Open conversation') : operation?.group === 'history' ? copy('Ver resultado', 'View result') : copy('Continuar operação', 'Continue operation')}</Link>}
          {job && ['PENDING', 'PREPARING'].includes(job.status) && <button className={button} disabled={busy} onClick={() => onCancel(job.batchId)}>{copy('Interromper próximos envios deste lote', 'Stop next sends in this batch')}</button>}
        </div>
      </article>
    })}</div>
    {pages > 1 && <nav aria-label={copy('Páginas de atividades', 'Activity pages')} className="mt-4 flex items-center justify-end gap-3"><button className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{copy('Anterior', 'Previous')}</button><span className="text-xs text-ink-muted">{currentPage + 1} / {pages}</span><button className={button} disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{copy('Próxima', 'Next')}</button></nav>}
    <p className="mt-4 text-xs leading-relaxed text-ink-muted">{copy('Última execução de cada operação da National Life e até 100 follow-ups recentes. Enviar uma mensagem não resolve automaticamente a pendência.', 'Latest run of each National Life operation and up to 100 recent follow-ups. Sending a message does not automatically resolve the pending item.')}</p>
  </section>
}
