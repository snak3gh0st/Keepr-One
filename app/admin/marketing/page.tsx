import Link from 'next/link'
import { requireRole } from '@/lib/require-role'
import { getServerI18n } from '@/lib/i18n/server'
import { formatNumber } from '@/lib/i18n/format'
import { parseLeadFilters, leadQueryString, readMarketingLeads, readMarketingSummary, readMarketingCampaigns, readMarketingOwners } from '@/lib/marketing/data'
import { LEAD_STATUSES } from '@/lib/marketing/types'
import { MarketingShell } from './MarketingShell'
import { LeadDirectory, ExportLeadsButton } from './LeadDirectory'
import { leadStatusLabel } from './labels'
import styles from './marketing.module.css'

export const dynamic = 'force-dynamic'

export default async function MarketingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const filters = parseLeadFilters(await searchParams)
  const [directory, summary, campaigns, owners] = await Promise.all([
    readMarketingLeads(filters), readMarketingSummary(), readMarketingCampaigns(), readMarketingOwners(),
  ])
  const filterKey = leadQueryString(filters)
  const advanced = Boolean(filters.ownerId || filters.period !== 'all' || filters.followUp !== 'all')

  return (
    <MarketingShell userName={session.user.name} active="leads" action={
      <Link href="/founders" target="_blank" rel="noopener noreferrer" className={styles.secondary}>
        {copy('Abrir página de captação', 'Open signup page')}
      </Link>
    }>
      <section className={styles.metrics} aria-label={copy('Resumo da base de leads', 'Lead base summary')}>
        {[
          { label: copy('Todos os leads', 'All leads'), count: summary.total, detail: copy('Base completa de contatos', 'Complete contact base'), href: '/admin/marketing' },
          { label: copy('Novos', 'New'), count: summary.new, detail: copy('Aguardando o primeiro contato', 'Waiting for the first contact'), href: '/admin/marketing?status=NEW' },
          { label: copy('Qualificados', 'Qualified'), count: summary.qualified, detail: copy('Prontos para o próximo passo', 'Ready for the next step'), href: '/admin/marketing?status=QUALIFIED' },
          { label: copy('Convertidos', 'Converted'), count: summary.converted, detail: copy('Marcados pela equipe', 'Marked by the team'), href: '/admin/marketing?status=CONVERTED' },
        ].map(metric => <Link key={metric.href} href={metric.href} className={styles.metric}>
          <span>{metric.label}</span><strong>{formatNumber(metric.count, language)}</strong><small>{metric.detail}</small>
        </Link>)}
      </section>
      {summary.overdue > 0 && <div className={styles.notice}>
        <span>{copy(`${summary.overdue} contato(s) com retorno pendente.`, `${summary.overdue} contact(s) have an overdue follow-up.`)}</span>
        <Link href="/admin/marketing?followup=overdue">{copy('Ver retornos pendentes', 'View overdue follow-ups')}</Link>
      </div>}
      <div className={styles.sectionHeading}>
        <div><h2>{copy('Sua base de leads', 'Your lead base')}</h2>
          <p>{copy('Os cadastros de Founders entram aqui automaticamente.', 'Founders signups arrive here automatically.')}</p>
        </div>
        <ExportLeadsButton query={leadQueryString(filters, { page: 1 })} disabled={directory.total === 0} />
      </div>
      <form key={`filters:${filterKey}`} action="/admin/marketing" className={styles.filters} aria-label={copy('Filtrar leads', 'Filter leads')}>
        <div className={`${styles.field} ${styles.searchField}`}>
          <label htmlFor="lead-query">{copy('Buscar contato', 'Search contacts')}</label>
          <input id="lead-query" name="q" type="search" defaultValue={filters.query} placeholder={copy('Nome, e-mail ou telefone', 'Name, email, or phone')} maxLength={200} />
        </div>
        <div className={styles.field}>
          <label htmlFor="lead-stage">{copy('Etapa', 'Stage')}</label>
          <select id="lead-stage" name="status" defaultValue={filters.status ?? ''}>
            <option value="">{copy('Todas as etapas', 'All stages')}</option>
            {LEAD_STATUSES.map(status => <option key={status} value={status}>{leadStatusLabel(status, copy)}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="lead-campaign">{copy('Campanha', 'Campaign')}</label>
          <select id="lead-campaign" name="campaign" defaultValue={filters.campaignId ?? ''}>
            <option value="">{copy('Todas as campanhas', 'All campaigns')}</option>
            {filters.campaignId && !campaigns.some(c => c.id === filters.campaignId) && <option value={filters.campaignId}>{copy('Campanha não encontrada', 'Campaign not found')}</option>}
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className={styles.filterActions}>
          <button className={styles.secondary} type="submit">{copy('Filtrar', 'Filter')}</button>
          {filterKey && <Link className={styles.textLink} href="/admin/marketing">{copy('Limpar', 'Clear')}</Link>}
        </div>
        <details className={styles.advancedFilters} open={advanced}>
          <summary>{copy('Mais filtros', 'More filters')}{advanced ? copy(' · em uso', ' · active') : ''}</summary>
          <div className={styles.advancedFields}>
            <div className={styles.field}>
              <label htmlFor="lead-owner">{copy('Responsável', 'Owner')}</label>
              <select id="lead-owner" name="owner" defaultValue={filters.ownerId ?? ''}>
                <option value="">{copy('Toda a equipe', 'Everyone')}</option><option value="none">{copy('Sem responsável', 'Unassigned')}</option>
                {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="lead-period">{copy('Data do cadastro', 'Signup date')}</label>
              <select id="lead-period" name="period" defaultValue={filters.period}>
                <option value="all">{copy('Todo o período', 'All time')}</option><option value="7d">{copy('Últimos 7 dias', 'Last 7 days')}</option><option value="30d">{copy('Últimos 30 dias', 'Last 30 days')}</option><option value="90d">{copy('Últimos 90 dias', 'Last 90 days')}</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="lead-followup">{copy('Próximo contato', 'Next contact')}</label>
              <select id="lead-followup" name="followup" defaultValue={filters.followUp}>
                <option value="all">{copy('Todos os contatos', 'All contacts')}</option><option value="overdue">{copy('Retornos pendentes', 'Overdue follow-ups')}</option><option value="scheduled">{copy('Com retorno agendado', 'Scheduled follow-ups')}</option>
              </select>
            </div>
          </div>
        </details>
      </form>
      <LeadDirectory key={`directory:${filterKey}`} directory={directory} filters={filters} hasFilters={Boolean(filterKey)} />
    </MarketingShell>
  )
}
