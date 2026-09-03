export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ModuleSummary } from '@/components/ModuleSummary'
import { getServerI18n } from '@/lib/i18n/server'
import { formatNumber } from '@/lib/i18n/format'
import { requireRole } from '@/lib/require-role'
import {
  parseAdminUserDirectoryFilters,
  readAdminUserDirectory,
  readAdminUserDirectorySummary,
} from '@/lib/admin/user-management'
import { UserDirectory, UserFilters } from './UserDirectory'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const filters = parseAdminUserDirectoryFilters(await searchParams)
  const [directory, summary] = await Promise.all([
    readAdminUserDirectory(filters),
    readAdminUserDirectorySummary(),
  ])

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Usuários', 'Users')}
        eyebrow={copy('Backoffice Keepr One', 'Keepr One back office')}
        description={copy(
          'Gerencie contas, dados cadastrais, planos, assinaturas e acesso com rastreabilidade administrativa.',
          'Manage accounts, profile data, plans, subscriptions, and access with an administrative audit trail.',
        )}
      >
        <Link
          href="/admin/users/new"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-rail-strong px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-rail focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          <span aria-hidden>+</span>
          {copy('Cadastrar usuário', 'Create user')}
        </Link>
      </PageHeader>

      <ModuleSummary
        label={copy('Base de usuários', 'User base')}
        items={[
          {
            label: copy('Usuários', 'Users'),
            value: formatNumber(summary.total, language),
            detail: copy(`${summary.active} com acesso ativo`, `${summary.active} with active access`),
            tone: 'green',
          },
          {
            label: copy('Agentes', 'Agents'),
            value: formatNumber(summary.agents, language),
            detail: copy('Contas operacionais na plataforma', 'Operational platform accounts'),
          },
          {
            label: copy('Agências', 'Agencies'),
            value: formatNumber(summary.agencies, language),
            detail: copy('Contas com Plano Agência', 'Accounts with an Agency plan'),
          },
          {
            label: copy('Precisa de atenção', 'Needs attention'),
            value: formatNumber(summary.needsAttention, language),
            detail: copy(
              `${summary.suspended} suspensos · ${summary.attention} com pagamento pendente · ${summary.review} para revisar`,
              `${summary.suspended} suspended · ${summary.attention} past due · ${summary.review} to review`,
            ),
            tone: summary.needsAttention > 0 ? 'danger' : 'neutral',
          },
        ]}
      />

      <UserFilters filters={filters} copy={copy} />
      <UserDirectory
        rows={directory.rows}
        total={directory.total}
        page={directory.page}
        pageCount={directory.pageCount}
        filters={filters}
        language={language}
        copy={copy}
      />
    </Shell>
  )
}
