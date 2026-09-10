'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { LEAD_STATUSES, type MarketingLeadRow, type AdminOption } from '@/lib/marketing/types'
import { updateLeadAction, addLeadNoteAction } from './actions'
import { leadStatusLabel } from './labels'
import styles from './marketing.module.css'

export function LeadFollowUpForm({ lead, owners }: { lead: MarketingLeadRow; owners: AdminOption[] }) {
  const { copy } = useI18n()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const initialContact = lead.nextContactAt ? DateTime.fromISO(lead.nextContactAt, { zone: 'America/New_York' }).toFormat("yyyy-MM-dd'T'HH:mm") : ''
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setMessage(null); setErrors({})
    const rawDate = String(data.get('nextContactAt') ?? '')
    if (rawDate) {
      const date = DateTime.fromISO(rawDate, { zone: 'America/New_York' })
      if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== rawDate) {
        setErrors({ nextContactAt: [copy('Escolha uma data e um horário válidos em Nova York.', 'Choose a valid date and time in New York.')] }); return
      }
      data.set('nextContactAt', date.toUTC().toISO() ?? '')
    }
    startTransition(async () => {
      try {
        const result = await updateLeadAction(data)
        if (result.ok) setMessage({ ok: true, text: copy('Acompanhamento salvo.', 'Follow-up saved.') })
        else { setErrors(result.fieldErrors ?? {}); setMessage({ ok: false, text: result.message }) }
      } catch { setMessage({ ok: false, text: copy('Não foi possível salvar. Tente novamente.', 'Unable to save. Please try again.') }) }
    })
  }
  const fieldError = (field: string) => errors[field]?.length ? <p id={`${field}-error`} className={styles.fieldError}>{errors[field].join(' ')}</p> : null
  return <form onSubmit={submit} className={styles.detailForm} aria-busy={pending}>
    <input name="id" type="hidden" value={lead.id} />
    <div className={styles.field}>
      <label htmlFor="contact-status">{copy('Etapa do lead', 'Lead stage')}</label>
      <select id="contact-status" name="status" defaultValue={lead.status} disabled={pending} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'status-error' : undefined}>
        {LEAD_STATUSES.map(status => <option value={status} key={status}>{leadStatusLabel(status, copy)}</option>)}
      </select>{fieldError('status')}
      <p className={styles.hint}>{copy('A etapa registra o resultado do atendimento. O acesso à plataforma é gerenciado em Usuários.', 'The stage records the outcome of the conversation. Platform access is managed in Users.')}</p>
    </div>
    <div className={styles.field}>
      <label htmlFor="contact-owner">{copy('Responsável pelo contato', 'Contact owner')}</label>
      <select id="contact-owner" name="ownerId" defaultValue={lead.owner?.id ?? ''} disabled={pending} aria-invalid={Boolean(errors.ownerId)} aria-describedby={errors.ownerId ? 'ownerId-error' : undefined}>
        <option value="">{copy('Sem responsável', 'Unassigned')}</option>
        {lead.owner && !owners.some(owner => owner.id === lead.owner?.id) && <option value={lead.owner.id} disabled>{lead.owner.name} {copy('(indisponível)', '(unavailable)')}</option>}
        {owners.map(owner => <option value={owner.id} key={owner.id}>{owner.name}</option>)}
      </select>{fieldError('ownerId')}
    </div>
    <div className={styles.field}>
      <label htmlFor="contact-next">{copy('Próximo contato', 'Next contact')}</label>
      <input id="contact-next" name="nextContactAt" type="datetime-local" defaultValue={initialContact} disabled={pending} aria-invalid={Boolean(errors.nextContactAt)} aria-describedby={`contact-timezone${errors.nextContactAt ? ' nextContactAt-error' : ''}`} />
      <p className={styles.hint} id="contact-timezone">{copy('Horário de Nova York (ET). Deixe vazio para remover o lembrete.', 'New York time (ET). Leave empty to remove the reminder.')}</p>
      {fieldError('nextContactAt')}
    </div>
    {message && <p className={message.ok ? styles.success : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    <button className={styles.primary} type="submit" disabled={pending}>{pending ? copy('Salvando…', 'Saving…') : copy('Salvar acompanhamento', 'Save follow-up')}</button>
  </form>
}

export function LeadNoteForm({ leadId }: { leadId: string }) {
  const { copy } = useI18n()
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!body.trim()) return
    const data = new FormData(event.currentTarget)
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await addLeadNoteAction(data)
        if (result.ok) { setBody(''); setMessage({ ok: true, text: copy('Nota adicionada ao histórico.', 'Note added to the history.') }) }
        else setMessage({ ok: false, text: result.message })
      } catch { setMessage({ ok: false, text: copy('Não foi possível salvar a nota. Tente novamente.', 'Unable to save the note. Please try again.') }) }
    })
  }
  return <form className={styles.detailForm} onSubmit={submit} aria-busy={pending}>
    <input type="hidden" name="leadId" value={leadId} />
    <div className={styles.field}>
      <label htmlFor="lead-note">{copy('Adicionar nota interna', 'Add an internal note')}</label>
      <textarea id="lead-note" name="body" value={body} onChange={event => setBody(event.target.value)} required maxLength={4000} disabled={pending} placeholder={copy('O que a equipe precisa saber sobre este contato?', 'What should the team know about this contact?')} />
    </div>
    <div className={styles.formFooter}>
      <p className={styles.hint}>{copy('Visível somente para a equipe administrativa.', 'Visible only to the admin team.')}</p>
      <button type="submit" className={styles.secondary} disabled={pending || !body.trim()}>{pending ? copy('Adicionando…', 'Adding…') : copy('Adicionar nota', 'Add note')}</button>
    </div>
    {message && <p className={message.ok ? styles.success : styles.error} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
  </form>
}
