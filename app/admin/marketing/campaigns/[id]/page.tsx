import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readMarketingCampaign } from '@/lib/marketing/data'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'
import { getServerI18n } from '@/lib/i18n/server'
import { requireRole } from '@/lib/require-role'
import { MarketingShell } from '../../MarketingShell'
import { CampaignForm } from '../CampaignForm'
import { CampaignLink } from '../CampaignLink'
import { campaignCapturePath, campaignPeriod, campaignStatusLabel } from '../campaign-labels'
import styles from '../campaigns.module.css'

export const dynamic = 'force-dynamic'

export default async function MarketingCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const { id } = await params
  const campaign = await readMarketingCampaign(id)
  if (!campaign) notFound()
  const { created } = await searchParams

  return (
    <MarketingShell userName={session.user.name} active="campaigns" title={campaign.name} description={copy('Gerencie o planejamento, compartilhe o link e acompanhe os leads desta campanha.', 'Manage planning, share the link, and follow this campaign’s leads.')} action={<Link href="/admin/marketing/campaigns" className={styles.secondaryLink}>{copy('Todas as campanhas', 'All campaigns')}</Link>}>
      <div className={styles.page}>
        {created === '1' ? <p role="status" className={styles.success}>{copy('Campanha criada. Seu link de captação está pronto para compartilhar.', 'Campaign created. Your lead capture link is ready to share.')}</p> : null}
        <div className={styles.detailLayout}>
          <CampaignForm campaign={campaign} />
          <aside className={styles.aside} aria-label={copy('Captação e resultados da campanha', 'Campaign capture and results')}>
            <CampaignLink key={`${campaign.slug}:${campaign.channel}`} path={campaignCapturePath(campaign.slug, campaign.channel)} />
            <section className={`${styles.panel} ${styles.capture}`} aria-labelledby="campaign-results-heading">
              <h2 id="campaign-results-heading" className={styles.heading}>{copy('Resultados da campanha', 'Campaign results')}</h2>
              <p className={styles.description}>{copy('Cadastros recebidos e evolução registrada pela equipe.', 'Received signups and progress recorded by your team.')}</p>
              <dl className={styles.details}>
                <div className={styles.detailRow}><dt>{copy('Leads captados', 'Captured leads')}</dt><dd>{formatNumber(campaign.totalLeads, language)}</dd></div>
                <div className={styles.detailRow}><dt>{copy('Convertidos', 'Converted')}</dt><dd>{formatNumber(campaign.convertedLeads, language)}</dd></div>
                <div className={styles.detailRow}><dt>Status</dt><dd><span className={styles.status} data-status={campaign.status}>{campaignStatusLabel(campaign.status, copy)}</span></dd></div>
                {campaign.budgetCents !== null ? <div className={styles.detailRow}><dt>{copy('Orçamento planejado', 'Planned budget')}</dt><dd>{formatCurrency(campaign.budgetCents / 100, language)}</dd></div> : null}
              </dl>
              <p className={styles.hint}>{campaignPeriod(campaign.startsAt, campaign.endsAt, language, copy)}</p>
              <div className={styles.captureActions}><Link href={`/admin/marketing?campaign=${campaign.id}`} className={styles.secondaryLink}>{copy('Ver leads da campanha', 'View campaign leads')}</Link></div>
            </section>
          </aside>
        </div>
      </div>
    </MarketingShell>
  )
}
