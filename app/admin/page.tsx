export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { periodFromDate, shiftPeriod, percentChange } from '@/lib/period'
import { sumByMonth } from '@/lib/dashboard'
import { decimalToNumber } from '@/lib/decimal'
import { diffAuditFields } from '@/lib/audit-diff'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { StatCard, StatCardHero } from '@/components/StatCard'
import { TrendChart } from '@/components/TrendChart'
import { LocalizedImportStatusPill, LocalizedRolePill } from './LocalizedStatusPills'
import { getServerI18n } from '@/lib/i18n/server'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'

export default async function AdminDashboard() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()

  const now = new Date()
  const currentP = periodFromDate(now)
  const previousP = shiftPeriod(currentP, -1)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

  const [
    agentsActive,
    policiesTotal,
    policiesInforce,
    premiumAgg,
    commissionCurrentAgg,
    commissionPreviousAgg,
    recentPolicies,
    recentImports,
    recentAudit,
  ] = await Promise.all([
    prisma.agent.count({ where: { status: 'ACTIVE' } }),
    prisma.policy.count(),
    prisma.policy.count({ where: { status: 'INFORCE' } }),
    prisma.policy.aggregate({ where: { status: 'INFORCE' }, _sum: { premium: true } }),
    prisma.commissionRecord.aggregate({ where: { period: currentP }, _sum: { amount: true } }),
    prisma.commissionRecord.aggregate({ where: { period: previousP }, _sum: { amount: true } }),
    prisma.policy.findMany({
      where: { createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, premium: true },
    }),
    prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { uploadedBy: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { user: true } }),
  ])

  const commissionCurrent = decimalToNumber(commissionCurrentAgg._sum.amount)
  const commissionPrevious = decimalToNumber(commissionPreviousAgg._sum.amount)
  const premiumBuckets = sumByMonth(
    recentPolicies.map((p) => ({ date: p.createdAt, amount: decimalToNumber(p.premium) })),
    6,
    now,
  )
  const importsNeedingAttention = recentImports.filter((b) => b.status !== 'COMPLETED')
  const money = (value: number) => formatCurrency(value, language, 'USD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const auditFieldLabels: Record<string, string> = {
    parentAgentId: copy('Gerente', 'Manager'),
    rank: copy('Cargo', 'Rank'),
    overridePercent: copy('Percentual de sobrecomissão', 'Override percentage'),
  }

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title={copy('Painel', 'Dashboard')}
        eyebrow={copy('Visão geral', 'Overview')}
        description={copy(
          'Acompanhe a operação, a produção e os itens que precisam de revisão.',
          'Track operations, production, and the items that need review.',
        )}
      >
        <Link href="/admin/import" className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep active:translate-y-px">
          {copy('Importar dados', 'Import data')} <span aria-hidden>↗</span>
        </Link>
      </PageHeader>

      <div className="mt-8">
        <StatCardHero
          label={copy('Comissão paga (este mês)', 'Commission paid (this month)')}
          value={money(commissionCurrent)}
          delta={percentChange(commissionCurrent, commissionPrevious)}
          deltaSuffix={copy(' vs mês anterior', ' vs previous month')}
        >
          <TrendChart
            compact
            tone="onDark"
            ariaLabel={copy('Tendência de novo prêmio por mês', 'New premium trend by month')}
            data={premiumBuckets.map((b) => ({ label: b.month.slice(5), value: b.total }))}
          />
        </StatCardHero>
      </div>

      <div className="mt-px grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border-steel bg-border-steel sm:grid-cols-3">
        <StatCard label={copy('Prêmio sob gestão', 'Premium under management')} value={money(decimalToNumber(premiumAgg._sum.premium))} />
        <StatCard label={copy('Apólices em vigor', 'Active policies')} value={`${formatNumber(policiesInforce, language)} / ${formatNumber(policiesTotal, language)}`} />
        <StatCard label={copy('Agentes ativos', 'Active agents')} value={formatNumber(agentsActive, language)} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-lg border border-border-steel bg-panel px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{copy('Novo prêmio por mês', 'New premium by month')}</h2>
          <div className="mt-4">
            <TrendChart
              ariaLabel={copy('Novo prêmio por mês', 'New premium by month')}
              data={premiumBuckets.map((b) => ({ label: b.month.slice(5), value: b.total }))}
            />
          </div>
        </div>
        <section className="rounded-lg border border-border-steel bg-paper">
          <div className="border-b border-border-steel px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{copy('Precisa de atenção', 'Needs attention')}</h2>
            <Link href="/admin/import" className="text-xs font-semibold text-teal hover:text-teal-deep">
              {copy('Ver importações', 'View imports')} →
            </Link>
          </div>
          </div>
          <div className="px-5 py-4">
          {importsNeedingAttention.length === 0 ? (
            <p className="text-sm text-ink-muted">{copy('Nenhuma importação pendente de revisão.', 'No imports are pending review.')}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {importsNeedingAttention.map((batch) => (
                <li key={batch.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{batch.filename}</span>
                  <LocalizedImportStatusPill status={batch.status} />
                </li>
              ))}
            </ul>
          )}
          </div>
        </section>

        <section className="rounded-lg border border-border-steel bg-paper lg:col-span-2">
          <div className="border-b border-border-steel px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{copy('Atividade recente', 'Recent activity')}</h2>
            <Link href="/admin/audit" className="text-xs font-semibold text-teal hover:text-teal-deep">
              {copy('Ver tudo', 'View all')} →
            </Link>
          </div>
          </div>
          <div className="px-5 py-4">
          {recentAudit.length === 0 ? (
            <p className="text-sm text-ink-muted">{copy('Nenhuma alteração registrada ainda.', 'No changes have been recorded yet.')}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {recentAudit.map((log) => {
                const diffs = diffAuditFields(log.before, log.after)
                const summary = diffs[0]
                  ? `${auditFieldLabels[diffs[0].field] ?? diffs[0].field}: ${diffs[0].before} → ${diffs[0].after}`
                  : log.action
                return (
                  <li key={log.id} className="flex items-center gap-2 text-sm">
                    <LocalizedRolePill role={log.user.role} />
                    <span className="truncate text-ink-muted">
                      <span className="font-medium text-ink">{log.user.name}</span> · {summary}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          </div>
        </section>
      </div>
    </Shell>
  )
}
