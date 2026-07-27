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
import { ImportStatusPill, RolePill } from '@/components/StatusPill'
import { StatCard, StatCardHero } from '@/components/StatCard'
import { TrendChart } from '@/components/TrendChart'

export default async function AdminDashboard() {
  const session = await requireRole('ADMIN')

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

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader title="Painel" eyebrow="Visão geral" description="Acompanhe a operação, a produção e os itens que precisam de revisão.">
        <Link href="/admin/import" className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep active:translate-y-px">
          Importar dados <span aria-hidden>↗</span>
        </Link>
      </PageHeader>

      <div className="mt-8">
        <StatCardHero
          label="Comissão paga (este mês)"
          value={`$${commissionCurrent.toFixed(2)}`}
          delta={percentChange(commissionCurrent, commissionPrevious)}
          deltaSuffix=" vs mês anterior"
        >
          <TrendChart compact tone="onDark" data={premiumBuckets.map((b) => ({ label: b.month.slice(5), value: b.total }))} />
        </StatCardHero>
      </div>

      <div className="mt-px grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border-steel bg-border-steel sm:grid-cols-3">
        <StatCard label="Prêmio sob gestão" value={`$${decimalToNumber(premiumAgg._sum.premium).toFixed(2)}`} />
        <StatCard label="Apólices em vigor" value={`${policiesInforce} / ${policiesTotal}`} />
        <StatCard label="Agentes ativos" value={agentsActive} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-lg border border-border-steel bg-panel px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Novo prêmio por mês</h2>
          <div className="mt-4">
            <TrendChart data={premiumBuckets.map((b) => ({ label: b.month.slice(5), value: b.total }))} />
          </div>
        </div>
        <section className="rounded-lg border border-border-steel bg-paper">
          <div className="border-b border-border-steel px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Precisa de atenção</h2>
            <Link href="/admin/import" className="text-xs font-semibold text-teal hover:text-teal-deep">
              Ver imports →
            </Link>
          </div>
          </div>
          <div className="px-5 py-4">
          {importsNeedingAttention.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum import pendente de revisão.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {importsNeedingAttention.map((batch) => (
                <li key={batch.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{batch.filename}</span>
                  <ImportStatusPill status={batch.status} />
                </li>
              ))}
            </ul>
          )}
          </div>
        </section>

        <section className="rounded-lg border border-border-steel bg-paper lg:col-span-2">
          <div className="border-b border-border-steel px-5 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Atividade recente</h2>
            <Link href="/admin/audit" className="text-xs font-semibold text-teal hover:text-teal-deep">
              Ver tudo →
            </Link>
          </div>
          </div>
          <div className="px-5 py-4">
          {recentAudit.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhuma alteração registrada ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {recentAudit.map((log) => {
                const diffs = diffAuditFields(log.before, log.after)
                const summary = diffs[0] ? `${diffs[0].field}: ${diffs[0].before} → ${diffs[0].after}` : log.action
                return (
                  <li key={log.id} className="flex items-center gap-2 text-sm">
                    <RolePill role={log.user.role} />
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
