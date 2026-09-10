import Link from 'next/link'
import { getServerI18n } from '@/lib/i18n/server'
import { requireRole } from '@/lib/require-role'
import { MarketingShell } from '../../MarketingShell'
import { CampaignForm } from '../CampaignForm'
import styles from '../campaigns.module.css'

export const dynamic = 'force-dynamic'

export default async function NewMarketingCampaignPage() {
  const session = await requireRole('ADMIN')
  const { copy } = await getServerI18n()
  return (
    <MarketingShell userName={session.user.name} active="campaigns" title={copy('Nova campanha', 'New campaign')} description={copy('Organize uma iniciativa e gere seu link de captação para a página Founders.', 'Organize an initiative and generate its lead capture link for the Founders page.')} action={<Link href="/admin/marketing/campaigns" className={styles.secondaryLink}>{copy('Todas as campanhas', 'All campaigns')}</Link>}>
      <div className={`${styles.page} ${styles.newForm}`}>
        <CampaignForm />
        <p className={styles.intro}>{copy('Ao criar a campanha, você recebe um link pronto para compartilhar e acompanhar seus resultados aqui.', 'Once you create the campaign, you will get a link ready to share and track its results here.')}</p>
      </div>
    </MarketingShell>
  )
}
