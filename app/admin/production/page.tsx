export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getMonthBounds, buildProductionRanking } from '@/lib/agent-production'
import { periodFromDate } from '@/lib/period'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { Select } from '@/components/Field'
import { Button } from '@/components/Button'
import { ContextPanel } from '@/components/ContextPanel'
import { ProductionTable } from './ProductionTable'
import { getServerI18n } from '@/lib/i18n/server'
import { formatDate, formatNumber } from '@/lib/i18n/format'

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const { period: periodParam } = await searchParams

  const distinctPeriods = await prisma.commissionRecord.findMany({
    distinct: ['period'],
    select: { period: true },
    orderBy: { period: 'desc' },
  })
  const periods = Array.from(
    new Set([...distinctPeriods.map((p) => p.period), periodFromDate(new Date())]),
  ).sort((a, b) => b.localeCompare(a))

  const period = periodParam && periods.includes(periodParam) ? periodParam : periods[0]
  const periodLabel = (value: string) => formatDate(`${value}-01T00:00:00.000Z`, language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const bounds = getMonthBounds(period)

  const [agents, policyStats, commissionStats] = await Promise.all([
    prisma.agent.findMany({ include: { user: true } }),
    prisma.policy.groupBy({
      by: ['agentId'],
      where: { createdAt: { gte: bounds.start, lt: bounds.end } },
      _count: true,
      _sum: { premium: true },
    }),
    prisma.commissionRecord.groupBy({
      by: ['agentId'],
      where: { period },
      _sum: { amount: true },
    }),
  ])

  const rows = buildProductionRanking(
    agents.map((a) => ({ id: a.id, name: a.user.name })),
    policyStats.map((p) => ({
      agentId: p.agentId,
      count: p._count,
      premiumSum: p._sum.premium?.toNumber() ?? 0,
    })),
    commissionStats.map((c) => ({
      agentId: c.agentId,
      sum: c._sum.amount?.toNumber() ?? 0,
    })),
  )

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader title={copy('Produção por agente', 'Production by agent')} eyebrow={copy('Desempenho', 'Performance')} description={copy('Compare apólices, prêmio e comissão por período.', 'Compare policies, premium, and commission by period.')} />

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <div className="mb-4 flex items-baseline justify-between"><h2 className="text-base font-semibold text-ink">{copy('Ranking do período', 'Period ranking')}</h2><span className="text-xs text-ink-muted">{rows.length === 1 ? copy('1 agente', '1 agent') : copy(`${formatNumber(rows.length, language)} agentes`, `${formatNumber(rows.length, language)} agents`)}</span></div>
        <ProductionTable rows={rows} />
        </section>
        <aside className="space-y-5 lg:sticky lg:top-6">
          <form method="GET" className="rounded-lg border border-border-steel bg-paper p-5"><h2 className="text-base font-semibold text-ink">{copy('Filtrar período', 'Filter period')}</h2><p className="mt-1 text-sm text-ink-muted">{copy('Escolha o mês que deseja comparar.', 'Choose the month you want to compare.')}</p><label className="mt-4 flex flex-col gap-2"><span className="text-xs font-semibold text-ink-muted">{copy('Mês', 'Month')}</span><Select name="period" defaultValue={period}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</Select></label><Button type="submit" variant="primary" className="mt-4 w-full">{copy('Aplicar filtro', 'Apply filter')}</Button></form>
          <ContextPanel eyebrow={copy('Leitura', 'Insights')} title={copy('Como usar', 'How to use')}><p>{copy('O ranking combina apólices criadas, prêmio total e comissão no mês selecionado.', 'The ranking combines policies created, total premium, and commission in the selected month.')}</p></ContextPanel>
        </aside>
      </div>
    </Shell>
  )
}
