'use client'

import { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { formatDate, formatNumber } from '@/lib/i18n/format'
import { LEAD_STATUSES, type LeadsPage, type LeadFilters } from '@/lib/marketing/types'
import { leadQueryString } from '@/lib/marketing/filters'
import { bulkUpdateLeadStatusAction } from './actions'
import { displayPhone, leadStatusLabel, isLeadOverdue } from './labels'
import styles from './marketing.module.css'

export function ExportLeadsButton({ query, disabled }: { query: string; disabled: boolean }) {
  const { copy } = useI18n()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    setPending(true); setError('')
    try {
      const response = await fetch(`/admin/marketing/export?${query}`)
      if (!response.ok || !response.headers.get('content-type')?.includes('text/csv')) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || body?.message || copy('Não foi possível exportar. Atualize a página e tente novamente.', 'Export failed. Refresh the page and try again.'))
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'keepr-marketing-leads.csv'
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy('Não foi possível exportar os leads.', 'Unable to export leads.'))
    } finally { setPending(false) }
  }
  return <div>
    <button type="button" className={styles.secondary} onClick={download} disabled={disabled || pending}>
      {pending ? copy('Preparando CSV…', 'Preparing CSV…') : copy('Exportar CSV', 'Export CSV')}
    </button>
    {error && <p role="alert" className={styles.fieldError}>{error}</p>}
  </div>
}

export function LeadDirectory({ directory, filters, hasFilters }: { directory: LeadsPage; filters: LeadFilters; hasFilters: boolean }) {
  const { copy, language } = useI18n()
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [stage, setStage] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const { rows, total, page, pageCount } = directory
  const visibleSelection = selected.filter(id => rows.some(row => row.id === id))
  const detailQuery = new URLSearchParams({ return: leadQueryString(filters) }).toString()
  const allSelected = rows.length > 0 && visibleSelection.length === rows.length
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  const shortDate = (value: string) => formatDate(value, language, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/New_York' })
  const contactDate = (value: string) => formatDate(value, language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })

  function applyStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stage || !visibleSelection.length) return
    const data = new FormData()
    visibleSelection.forEach(id => data.append('ids', id)); data.set('status', stage)
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await bulkUpdateLeadStatusAction(data)
        if (result.ok) {
          setSelected([]); setStage('')
          setMessage({ ok: true, text: copy('Etapa atualizada para os contatos selecionados.', 'Selected contacts updated.') })
        } else setMessage({ ok: false, text: result.message })
      } catch { setMessage({ ok: false, text: copy('Não foi possível atualizar. Tente novamente.', 'Unable to update. Please try again.') }) }
    })
  }

  return <section className={styles.list} aria-label={copy('Lista de leads', 'Lead list')} aria-busy={pending}>
    <div className={styles.listToolbar}>
      <label className={styles.selectAll}>
        <input type="checkbox" checked={allSelected} disabled={!rows.length || pending} onChange={() => setSelected(allSelected ? [] : rows.map(row => row.id))} aria-label={copy('Selecionar todos os leads desta página', 'Select all leads on this page')} />
        {visibleSelection.length ? copy(`${visibleSelection.length} selecionados`, `${visibleSelection.length} selected`) : copy(`${formatNumber(total, language)} contatos`, `${formatNumber(total, language)} contacts`)}
      </label>
      {visibleSelection.length ? <form onSubmit={applyStatus} className={styles.toolbarActions}>
        <select className={styles.input} value={stage} onChange={event => setStage(event.target.value)} aria-label={copy('Nova etapa dos selecionados', 'New stage for selected leads')} disabled={pending} required>
          <option value="">{copy('Escolha uma etapa', 'Choose a stage')}</option>
          {LEAD_STATUSES.map(status => <option key={status} value={status}>{leadStatusLabel(status, copy)}</option>)}
        </select>
        <button className={styles.primary} type="submit" disabled={!stage || pending}>{pending ? copy('Aplicando…', 'Applying…') : copy('Aplicar etapa', 'Apply stage')}</button>
        <button type="button" className={styles.secondary} disabled={pending} onClick={() => setSelected([])}>{copy('Cancelar', 'Cancel')}</button>
      </form> : <button className={styles.secondary} type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? copy('Atualizando…', 'Refreshing…') : copy('Atualizar lista', 'Refresh list')}</button>}
    </div>
    {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? styles.success : styles.error}>{message.text}</p>}
    {rows.length === 0 ? <div className={styles.empty}>
      <h3>{hasFilters ? copy('Nenhum contato com estes filtros.', 'No contacts match these filters.') : copy('Sua próxima oportunidade começa aqui.', 'Your next opportunity starts here.')}</h3>
      <p>{hasFilters ? copy('Tente outro nome, etapa ou período para encontrar o que procura.', 'Try another name, stage, or date range to find what you need.') : copy('Compartilhe a página de Founders. Cada cadastro chegará a esta lista, pronto para o primeiro contato.', 'Share the Founders signup page. Every signup will appear here, ready for the first contact.')}</p>
      <Link className={styles.secondary} href={hasFilters ? '/admin/marketing' : '/admin/marketing/campaigns/founders-program'}>{hasFilters ? copy('Limpar filtros', 'Clear filters') : copy('Ver campanha Founders', 'View Founders campaign')}</Link>
    </div> : <>
      <table className={styles.table}>
        <caption className="sr-only">{copy('Contatos captados pelas campanhas de Marketing', 'Contacts captured by marketing campaigns')}</caption>
        <thead><tr><th><span className="sr-only">{copy('Selecionar', 'Select')}</span></th><th scope="col">{copy('Contato', 'Contact')}</th><th scope="col">{copy('Etapa', 'Stage')}</th><th scope="col">{copy('Campanha', 'Campaign')}</th><th scope="col">{copy('Responsável', 'Owner')}</th><th scope="col">{copy('Próximo contato', 'Next contact')}</th><th scope="col">{copy('Cadastro', 'Signup')}</th></tr></thead>
        <tbody>{rows.map(lead => <tr key={lead.id}>
          <td><input type="checkbox" aria-label={copy(`Selecionar ${lead.name}`, `Select ${lead.name}`)} checked={visibleSelection.includes(lead.id)} onChange={() => toggle(lead.id)} disabled={pending} /></td>
          <td><Link className={styles.leadName} href={`/admin/marketing/leads/${lead.id}?${detailQuery}`}>{lead.name}</Link><a className={`${styles.subline} ${styles.contactLink}`} href={`mailto:${lead.email}`}>{lead.email}</a><span className={styles.subline}>{displayPhone(lead.phone)}</span></td>
          <td><span className={styles.pill} data-status={lead.status}>{leadStatusLabel(lead.status, copy)}</span></td>
          <td><Link className={styles.contactLink} href={`/admin/marketing/campaigns/${lead.campaign.id}`}>{lead.campaign.name}</Link></td>
          <td>{lead.owner?.name ?? <span className={styles.subline}>{copy('Sem responsável', 'Unassigned')}</span>}</td>
          <td>{lead.nextContactAt ? <><span>{contactDate(lead.nextContactAt)}</span>{isLeadOverdue(lead) && <span className={`${styles.subline} ${styles.due}`}>{copy('Retorno pendente', 'Overdue')}</span>}</> : <span className={styles.subline}>{copy('Não agendado', 'Not scheduled')}</span>}</td>
          <td><time dateTime={lead.createdAt}>{shortDate(lead.createdAt)}</time></td>
        </tr>)}</tbody>
      </table>
      <div className={styles.mobileList}>
        {rows.map(lead => <article key={lead.id} className={styles.mobileLead}>
          <div className={styles.mobileLeadHeader}>
            <input type="checkbox" aria-label={copy(`Selecionar ${lead.name}`, `Select ${lead.name}`)} checked={visibleSelection.includes(lead.id)} onChange={() => toggle(lead.id)} disabled={pending} />
            <div><Link className={styles.leadName} href={`/admin/marketing/leads/${lead.id}?${detailQuery}`}>{lead.name}</Link><span className={styles.subline}>{lead.email}</span><span className={styles.subline}>{displayPhone(lead.phone)}</span></div>
          </div>
          <div className={styles.mobileLeadInfo}>
            <div><span className={styles.pill} data-status={lead.status}>{leadStatusLabel(lead.status, copy)}</span><p className={styles.subline}>{lead.campaign.name}</p><p className={styles.subline}>{lead.owner?.name ?? copy('Sem responsável', 'Unassigned')}</p></div>
            <div><time className={styles.subline} dateTime={lead.createdAt}>{shortDate(lead.createdAt)}</time>{lead.nextContactAt && <p className={isLeadOverdue(lead) ? styles.due : styles.subline}>{copy('Retorno: ', 'Follow-up: ')}{contactDate(lead.nextContactAt)}</p>}</div>
          </div>
        </article>)}
      </div>
    </>}
    <div className={styles.pagination}>
      <span>{copy(`Página ${page} de ${pageCount}`, `Page ${page} of ${pageCount}`)}<span className={styles.subline}>{copy('Datas no horário de Nova York.', 'Dates in New York time.')}</span></span>
      <nav aria-label={copy('Páginas de leads', 'Lead pages')}>
        {page > 1 && <Link href={`/admin/marketing?${leadQueryString(filters, { page: page - 1 })}`}>{copy('Anterior', 'Previous')}</Link>}
        {page < pageCount && <Link href={`/admin/marketing?${leadQueryString(filters, { page: page + 1 })}`}>{copy('Próxima', 'Next')}</Link>}
      </nav>
    </div>
  </section>
}
