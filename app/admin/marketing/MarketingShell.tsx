import type { ReactNode } from 'react'
import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { getServerI18n } from '@/lib/i18n/server'
import styles from './marketing.module.css'

export async function MarketingShell({ userName, active, title, description, action, children }: {
  userName: string
  active: 'leads' | 'campaigns'
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  const { copy } = await getServerI18n()
  return (
    <Shell role="ADMIN" userName={userName}>
      <div className={styles.workspace}>
        <PageHeader title={title ?? 'Marketing'} description={description ?? copy(
          'Da primeira conexão ao próximo passo. Suas campanhas e seus leads, no mesmo lugar.',
          'From the first connection to the next step. Your campaigns and leads, together.',
        )}>{action}</PageHeader>
        <nav className={styles.tabs} aria-label={copy('Navegação de Marketing', 'Marketing navigation')}>
          <Link href="/admin/marketing" aria-current={active === 'leads' ? 'page' : undefined}>
            {copy('Leads', 'Leads')}
          </Link>
          <Link href="/admin/marketing/campaigns" aria-current={active === 'campaigns' ? 'page' : undefined}>
            {copy('Campanhas', 'Campaigns')}
          </Link>
        </nav>
        {children}
      </div>
    </Shell>
  )
}
