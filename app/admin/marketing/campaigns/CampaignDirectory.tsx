'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { formatNumber } from '@/lib/i18n/format'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, type CampaignRow } from '@/lib/marketing/types'
import { campaignChannelLabel, campaignPeriod, campaignStatusLabel } from './campaign-labels'
import styles from './campaigns.module.css'

export function CampaignDirectory({ campaigns }: { campaigns: CampaignRow[] }) {
  const { copy, language } = useI18n()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
  const filtered = campaigns.filter((campaign) =>
    (!status || campaign.status === status) &&
    (!channel || campaign.channel === channel) &&
    normalize(`${campaign.name} ${campaign.description ?? ''}`).includes(normalize(query.trim())),
  )
  const hasFilters = Boolean(query || status || channel)

  return (
    <section className={styles.panel} aria-labelledby="campaign-directory-heading">
      <div className={styles.panelHead}>
        <div>
          <h2 id="campaign-directory-heading" className={styles.heading}>{copy('Suas campanhas', 'Your campaigns')}</h2>
          <p className={styles.description}>{copy('Acompanhe de onde vêm os leads e a evolução de cada iniciativa.', 'Track where leads come from and how each initiative is progressing.')}</p>
        </div>
      </div>
      {campaigns.length > 0 ? (
        <>
          <div className={styles.filters} role="search" aria-label={copy('Filtrar campanhas', 'Filter campaigns')}>
            <div className={styles.filterField}>
              <label htmlFor="campaign-search" className={styles.label}>{copy('Buscar campanha', 'Search campaigns')}</label>
              <input id="campaign-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy('Nome ou objetivo', 'Name or objective')} className={styles.input} />
            </div>
            <div className={styles.filterField}>
              <label htmlFor="campaign-status-filter" className={styles.label}>{copy('Status', 'Status')}</label>
              <select id="campaign-status-filter" value={status} onChange={(event) => setStatus(event.target.value)} className={styles.input}>
                <option value="">{copy('Todos os status', 'All statuses')}</option>
                {CAMPAIGN_STATUSES.map((value) => <option key={value} value={value}>{campaignStatusLabel(value, copy)}</option>)}
              </select>
            </div>
            <div className={styles.filterField}>
              <label htmlFor="campaign-channel-filter" className={styles.label}>{copy('Canal', 'Channel')}</label>
              <select id="campaign-channel-filter" value={channel} onChange={(event) => setChannel(event.target.value)} className={styles.input}>
                <option value="">{copy('Todos os canais', 'All channels')}</option>
                {CAMPAIGN_CHANNELS.map((value) => <option key={value} value={value}>{campaignChannelLabel(value, copy)}</option>)}
              </select>
            </div>
          </div>
          <p className={styles.resultCount} role="status">{copy(`${formatNumber(filtered.length, language)} de ${formatNumber(campaigns.length, language)} campanhas`, `${formatNumber(filtered.length, language)} of ${formatNumber(campaigns.length, language)} campaigns`)}</p>
        </>
      ) : null}
      {filtered.length > 0 ? (
        <table className={styles.table}>
          <caption className="sr-only">{copy('Campanhas de marketing e seus resultados', 'Marketing campaigns and their results')}</caption>
          <thead><tr>
            <th scope="col">{copy('Campanha', 'Campaign')}</th>
            <th scope="col">{copy('Canal', 'Channel')}</th>
            <th scope="col">{copy('Status', 'Status')}</th>
            <th scope="col">{copy('Período planejado', 'Planned dates')}</th>
            <th scope="col" className={styles.numeric}>Leads</th>
            <th scope="col" className={styles.numeric}>{copy('Convertidos', 'Converted')}</th>
          </tr></thead>
          <tbody>{filtered.map((campaign) => (
            <tr key={campaign.id}>
              <td>
                <Link className={styles.campaignName} href={`/admin/marketing/campaigns/${campaign.id}`}>{campaign.name}</Link>
                {campaign.description ? <p className={styles.campaignDescription}>{campaign.description}</p> : null}
              </td>
              <td data-label={copy('Canal', 'Channel')}>{campaignChannelLabel(campaign.channel, copy)}</td>
              <td data-label={copy('Status', 'Status')}><span className={styles.status} data-status={campaign.status}>{campaignStatusLabel(campaign.status, copy)}</span></td>
              <td data-label={copy('Período planejado', 'Planned dates')}><span className={styles.period}>{campaignPeriod(campaign.startsAt, campaign.endsAt, language, copy)}</span></td>
              <td data-label="Leads" className={styles.numeric}><Link href={`/admin/marketing?campaign=${campaign.id}`} className={styles.textLink} aria-label={copy(`Ver ${campaign.totalLeads} leads da campanha ${campaign.name}`, `View ${campaign.totalLeads} leads for ${campaign.name}`)}>{formatNumber(campaign.totalLeads, language)}</Link></td>
              <td data-label={copy('Convertidos', 'Converted')} className={styles.numeric}>{formatNumber(campaign.convertedLeads, language)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <div className={styles.empty}>
          <h3 className={styles.heading}>{hasFilters ? copy('Nenhuma campanha encontrada', 'No campaigns found') : copy('Sua próxima campanha começa aqui', 'Your next campaign starts here')}</h3>
          <p>{hasFilters ? copy('Ajuste a busca ou os filtros para encontrar outra campanha.', 'Adjust your search or filters to find another campaign.') : copy('Crie uma campanha para organizar a divulgação e acompanhar os leads pelo link de captação.', 'Create a campaign to organize promotion and track leads through its capture link.')}</p>
          {hasFilters ? <Button onClick={() => { setQuery(''); setStatus(''); setChannel('') }}>{copy('Limpar filtros', 'Clear filters')}</Button> : <Link href="/admin/marketing/campaigns/new" className={styles.primaryLink}>{copy('Criar primeira campanha', 'Create first campaign')}</Link>}
        </div>
      )}
    </section>
  )
}
