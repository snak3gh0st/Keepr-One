import Link from 'next/link'
import { ModuleSummary } from '@/components/ModuleSummary'
import { readMarketingCampaigns } from '@/lib/marketing/data'
import { formatNumber } from '@/lib/i18n/format'
import { getServerI18n } from '@/lib/i18n/server'
import { requireRole } from '@/lib/require-role'
import { MarketingShell } from '../MarketingShell'
import { CampaignDirectory } from './CampaignDirectory'
import styles from './campaigns.module.css'

export const dynamic = 'force-dynamic'

export default async function MarketingCampaignsPage() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const campaigns = await readMarketingCampaigns()
  const totalLeads = campaigns.reduce((total, campaign) => total + campaign.totalLeads, 0)
  const converted = campaigns.reduce((total, campaign) => total + campaign.convertedLeads, 0)

  return (
    <MarketingShell userName={session.user.name} active="campaigns" title={copy('Campanhas', 'Campaigns')} description={copy('Planeje a divulgação e acompanhe os leads que cada campanha traz para a Keepr One.', 'Plan your promotion and follow the leads each campaign brings to Keepr One.')} action={<Link className={styles.primaryLink} href="/admin/marketing/campaigns/new">{copy('Nova campanha', 'New campaign')}</Link>}>
      <div className={styles.page}>
        <ModuleSummary items={[
          { label: copy('Campanhas ativas', 'Active campaigns'), value: formatNumber(campaigns.filter((campaign) => campaign.status === 'ACTIVE').length, language), detail: copy(`${campaigns.length} campanhas no total`, `${campaigns.length} campaigns in total`), tone: 'green' },
          { label: copy('Leads captados', 'Captured leads'), value: formatNumber(totalLeads, language), detail: copy('Cadastros atribuídos às campanhas', 'Signups attributed to campaigns') },
          { label: copy('Leads convertidos', 'Converted leads'), value: formatNumber(converted, language), detail: copy('Marcados como convertidos pela equipe', 'Marked as converted by the team') },
        ]} />
        <CampaignDirectory campaigns={campaigns} />
      </div>
    </MarketingShell>
  )
}
