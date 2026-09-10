'use client'

import Link from 'next/link'
import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { saveCampaignAction } from '@/app/admin/marketing/actions'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, type CampaignRow } from '@/lib/marketing/types'
import { campaignChannelLabel, campaignStatusLabel } from './campaign-labels'
import styles from './campaigns.module.css'

export function CampaignForm({ campaign }: { campaign?: CampaignRow }) {
  const { copy } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const feedback = useRef<HTMLParagraphElement>(null)
  const error = (name: string) => fieldErrors[name]?.[0]
  const errorId = (name: string) => error(name) ? `campaign-${name}-error` : undefined

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const data = new FormData(event.currentTarget)
    setMessage('')
    setSaved(false)
    setFieldErrors({})
    startTransition(async () => {
      try {
        const result = await saveCampaignAction(data)
        if (!result.ok) {
          setMessage(result.message)
          setFieldErrors(result.fieldErrors ?? {})
          requestAnimationFrame(() => feedback.current?.focus())
          return
        }
        if (!campaign && result.id) {
          router.push(`/admin/marketing/campaigns/${encodeURIComponent(result.id)}?created=1`)
          return
        }
        setSaved(true)
        router.refresh()
      } catch {
        setMessage(copy('Não foi possível salvar a campanha. Seus dados continuam aqui; tente novamente.', 'The campaign could not be saved. Your entries are still here; please try again.'))
        requestAnimationFrame(() => feedback.current?.focus())
      }
    })
  }

  return (
    <form onSubmit={submit} className={`${styles.panel} ${styles.form}`} aria-busy={pending}>
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}
      <fieldset disabled={pending} className={styles.formSection} aria-labelledby="campaign-details-heading">
        <h2 id="campaign-details-heading" className={styles.heading}>{copy('Dados da campanha', 'Campaign details')}</h2>
        <p className={styles.description}>{copy('Dê um nome à iniciativa e defina por onde os leads chegarão.', 'Name this initiative and define where its leads will come from.')}</p>
        <div className={styles.formFields}>
          <div className={styles.field}>
            <label htmlFor="campaign-name" className={styles.label}>{copy('Nome da campanha', 'Campaign name')}</label>
            <input id="campaign-name" name="name" defaultValue={campaign?.name ?? ''} required minLength={2} maxLength={120} className={styles.input} placeholder={copy('Ex.: Founders · lançamento', 'E.g. Founders · launch')} aria-invalid={Boolean(error('name'))} aria-describedby={errorId('name')} />
            {error('name') ? <p id={errorId('name')} className={styles.fieldError}>{error('name')}</p> : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="campaign-description" className={styles.label}>{copy('Objetivo e contexto', 'Objective and context')} <span className={styles.hint}>{copy('(opcional)', '(optional)')}</span></label>
            <textarea id="campaign-description" name="description" defaultValue={campaign?.description ?? ''} maxLength={2000} className={`${styles.input} ${styles.textarea}`} placeholder={copy('Público, mensagem e o que a campanha deve alcançar.', 'Audience, message, and what this campaign should achieve.')} aria-invalid={Boolean(error('description'))} aria-describedby={errorId('description')} />
            {error('description') ? <p id={errorId('description')} className={styles.fieldError}>{error('description')}</p> : null}
          </div>
          <div className={styles.twoColumns}>
            <div className={styles.field}>
              <label htmlFor="campaign-channel" className={styles.label}>{copy('Canal de aquisição', 'Acquisition channel')}</label>
              <select id="campaign-channel" name="channel" defaultValue={campaign?.channel ?? 'ORGANIC'} className={styles.input} aria-invalid={Boolean(error('channel'))} aria-describedby={errorId('channel')}>
                {CAMPAIGN_CHANNELS.map((channel) => <option key={channel} value={channel}>{campaignChannelLabel(channel, copy)}</option>)}
              </select>
              {error('channel') ? <p id={errorId('channel')} className={styles.fieldError}>{error('channel')}</p> : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="campaign-status" className={styles.label}>{copy('Status', 'Status')}</label>
              <select id="campaign-status" name="status" defaultValue={campaign?.status ?? 'DRAFT'} className={styles.input} aria-invalid={Boolean(error('status'))} aria-describedby={errorId('status')}>
                {CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{campaignStatusLabel(status, copy)}</option>)}
              </select>
              {error('status') ? <p id={errorId('status')} className={styles.fieldError}>{error('status')}</p> : null}
            </div>
          </div>
          <p className={styles.hint}>{copy('O status organiza o planejamento. O link continua recebendo leads em todos os status.', 'The status organizes planning. The link continues receiving leads in every status.')}</p>
        </div>
      </fieldset>
      <fieldset disabled={pending} className={styles.formSection} aria-labelledby="campaign-planning-heading">
        <h2 id="campaign-planning-heading" className={styles.heading}>{copy('Planejamento', 'Planning')}</h2>
        <p className={styles.description}>{copy('Datas e orçamento são opcionais e servem para organizar a campanha.', 'Dates and budget are optional and help organize your campaign.')}</p>
        <div className={styles.formFields}>
          <div className={styles.twoColumns}>
            <div className={styles.field}>
              <label htmlFor="campaign-startsAt" className={styles.label}>{copy('Data de início', 'Start date')}</label>
              <input id="campaign-startsAt" name="startsAt" type="date" defaultValue={campaign?.startsAt?.slice(0, 10) ?? ''} className={styles.input} aria-invalid={Boolean(error('startsAt'))} aria-describedby={errorId('startsAt')} />
              {error('startsAt') ? <p id={errorId('startsAt')} className={styles.fieldError}>{error('startsAt')}</p> : null}
            </div>
            <div className={styles.field}>
              <label htmlFor="campaign-endsAt" className={styles.label}>{copy('Data de término', 'End date')}</label>
              <input id="campaign-endsAt" name="endsAt" type="date" defaultValue={campaign?.endsAt?.slice(0, 10) ?? ''} className={styles.input} aria-invalid={Boolean(error('endsAt'))} aria-describedby={errorId('endsAt')} />
              {error('endsAt') ? <p id={errorId('endsAt')} className={styles.fieldError}>{error('endsAt')}</p> : null}
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="campaign-budget" className={styles.label}>{copy('Orçamento planejado (USD)', 'Planned budget (USD)')}</label>
            <input id="campaign-budget" name="budget" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={campaign?.budgetCents != null ? (campaign.budgetCents / 100).toFixed(2) : ''} className={styles.input} placeholder="0.00" aria-invalid={Boolean(error('budget'))} aria-describedby={['campaign-budget-hint', errorId('budget')].filter(Boolean).join(' ')} />
            <p id="campaign-budget-hint" className={styles.hint}>{copy('Valor de referência para a equipe. Não representa o gasto realizado.', 'A reference amount for your team. It does not represent actual spend.')}</p>
            {error('budget') ? <p id={errorId('budget')} className={styles.fieldError}>{error('budget')}</p> : null}
          </div>
        </div>
      </fieldset>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? copy('Salvando campanha…', 'Saving campaign…') : campaign ? copy('Salvar alterações', 'Save changes') : copy('Criar campanha', 'Create campaign')}
        </Button>
        <Link href="/admin/marketing/campaigns" className={styles.textLink}>{copy('Voltar para campanhas', 'Back to campaigns')}</Link>
      </div>
      {message ? <p ref={feedback} role="alert" tabIndex={-1} className={styles.feedback}>{message}</p> : null}
      {saved ? <p role="status" className={styles.savedFeedback}>{copy('Alterações salvas.', 'Changes saved.')}</p> : null}
    </form>
  )
}
