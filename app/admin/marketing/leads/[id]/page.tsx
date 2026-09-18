import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/require-role'
import { getServerI18n } from '@/lib/i18n/server'
import { formatDate } from '@/lib/i18n/format'
import { readMarketingLead, readMarketingOwners, parseLeadFilters, leadQueryString } from '@/lib/marketing/data'
import { MarketingShell } from '../../MarketingShell'
import { leadStatusLabel, displayPhone } from '../../labels'
import { LeadFollowUpForm, LeadNoteForm } from '../../LeadForms'
import { LeadAccessInvite } from '../../LeadAccessInvite'
import styles from '../../marketing.module.css'

export const dynamic = 'force-dynamic'

export default async function MarketingLeadPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const { id } = await params
  const [lead, owners, query] = await Promise.all([readMarketingLead(id), readMarketingOwners(), searchParams])
  if (!lead) notFound()
  const rawReturn = Array.isArray(query.return) ? query.return[0] : query.return
  const returnQuery = leadQueryString(parseLeadFilters(new URLSearchParams(rawReturn?.slice(0, 1500))))
  const date = (value: string) => formatDate(value, language, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })
  const attribution = [
    [copy('Fonte', 'Source'), lead.utmSource], [copy('Mídia', 'Medium'), lead.utmMedium],
    [copy('Campanha UTM', 'UTM campaign'), lead.utmCampaign], [copy('Conteúdo', 'Content'), lead.utmContent], [copy('Termo', 'Term'), lead.utmTerm],
  ].filter(([, value]) => value)

  return <MarketingShell userName={session.user.name} active="leads" title={copy('Contato', 'Contact')} description={copy('O contexto que você precisa para continuar a conversa.', 'The context you need to continue the conversation.')}>
    <Link href={`/admin/marketing${returnQuery ? `?${returnQuery}` : ''}`} className={styles.back}>{copy('Voltar para leads', 'Back to leads')}</Link>
    <div className={styles.detailGrid}>
        <section className={`${styles.panel} ${styles.contactPanel}`} aria-label={copy('Dados do contato', 'Contact details')}>
          <span className={styles.pill} data-status={lead.status}>{leadStatusLabel(lead.status, copy)}</span>
          <h2 className={styles.contactName}>{lead.name}</h2>
          <dl className={styles.details}>
            <div><dt>{copy('E-mail', 'Email')}</dt><dd><a href={`mailto:${lead.email}`}>{lead.email}</a></dd></div>
            <div><dt>{copy('Telefone', 'Phone')}</dt><dd><a href={`tel:${lead.phone}`}>{displayPhone(lead.phone)}</a></dd></div>
            <div><dt>{copy('Campanha', 'Campaign')}</dt><dd><Link href={`/admin/marketing/campaigns/${lead.campaign.id}`}>{lead.campaign.name}</Link></dd></div>
            <div><dt>{copy('Origem', 'Origin')}</dt><dd>{lead.source === 'FOUNDERS' ? copy('Formulário Founders', 'Founders signup form') : lead.source}</dd></div>
            <div><dt>{copy('Cadastrado em', 'Signed up')}</dt><dd><time dateTime={lead.createdAt}>{date(lead.createdAt)}</time><span className={styles.subline}>{copy('Horário de Nova York', 'New York time')}</span></dd></div>
          </dl>
          <div className={styles.contactActions}>
            <a className={styles.secondary} href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={copy(`Abrir WhatsApp de ${lead.name} em nova aba`, `Open WhatsApp for ${lead.name} in a new tab`)}>WhatsApp</a>
            <a className={styles.secondary} href={`mailto:${lead.email}`}>{copy('Escrever e-mail', 'Write email')}</a>
            <a className={styles.secondary} href={`tel:${lead.phone}`}>{copy('Ligar', 'Call')}</a>
          </div>
          <LeadAccessInvite leadId={lead.id} />
          <details className={styles.metadata}>
            <summary>{copy('Rastreamento do cadastro', 'Signup attribution')}</summary>
            {attribution.length ? <dl className={styles.details}>{attribution.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <p className={styles.hint}>{copy('Cadastro direto, sem parâmetros de campanha.', 'Direct signup, without campaign parameters.')}</p>}
            <p className={styles.hint}>{copy('A origem registrada é a do primeiro cadastro deste e-mail.', 'Attribution reflects the first signup for this email.')}</p>
          </details>
        </section>
      <section className={`${styles.panel} ${styles.followupPanel}`} aria-labelledby="lead-followup-heading">
        <h2 id="lead-followup-heading">{copy('Acompanhamento', 'Follow-up')}</h2>
        <LeadFollowUpForm key={lead.id} lead={lead} owners={owners} />
      </section>
        <section className={`${styles.panel} ${styles.notesPanel}`} aria-labelledby="lead-notes-heading">
          <h2 id="lead-notes-heading">{copy('Histórico de notas', 'Notes history')}</h2>
          <LeadNoteForm leadId={lead.id} />
          {lead.notes.length ? <ol className={styles.notes}>{lead.notes.map(note => <li key={note.id} className={styles.note}>
            <p>{note.body}</p><footer><strong>{note.authorName ?? copy('Equipe Keepr One', 'Keepr One team')}</strong><time dateTime={note.createdAt}>{date(note.createdAt)}</time></footer>
          </li>)}</ol> : <p className={styles.hint}>{copy('Registre a primeira conversa, o interesse do contato ou um combinado para o próximo retorno.', 'Record the first conversation, their interests, or a plan for the next follow-up.')}</p>}
        </section>
    </div>
  </MarketingShell>
}
