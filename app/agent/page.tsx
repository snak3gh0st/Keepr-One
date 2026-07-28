export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { decimalToNumber } from '@/lib/decimal'
import { periodFromDate, shiftPeriod, percentChange } from '@/lib/period'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import { policyStatusLabel } from '@/components/StatusPill'
import { TrendChart } from '@/components/TrendChart'
import {
  KeeprDashboardMotion,
} from '@/components/KeeprDashboardMotion'
import { OperationSignals, type OperationSignal } from '@/components/OperationSignals'

function BreakdownList({
  title,
  rows,
}: {
  title: string
  rows: { label: string; count: number }[]
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="keepr-accordion-panel min-h-[280px] border-b border-border-steel/75 bg-paper/74 p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 sm:p-7">
      <h3 className="text-lg font-medium tracking-[-0.025em] text-ink">{title}</h3>
      <ul className="mt-7 flex flex-col gap-4">
        {rows.slice(0, 5).map((row) => (
          <li key={row.label} className="group flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 truncate text-ink-muted">{row.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas-deep">
              <span
                className="block h-full origin-left rounded-full bg-teal transition-transform duration-700 ease-out group-hover:scale-x-105"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
              {row.count}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-ink-muted">Nenhum dado disponível ainda.</li>}
      </ul>
    </div>
  )
}

function PriorityRow({
  href,
  label,
  value,
  tone,
}: {
  href: string
  label: string
  value: number | null
  tone: 'mint' | 'amber' | 'danger'
}) {
  const toneClass =
    value === null || value === 0
      ? 'bg-canvas-deep text-ink-muted'
      : tone === 'danger'
        ? 'bg-danger-pale text-danger'
        : tone === 'amber'
          ? 'bg-gold-pale text-gold-ink'
          : 'bg-teal-pale text-teal-deep'

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition-all duration-300 hover:border-border-steel hover:bg-paper"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold tabular-nums ${toneClass}`}>
        {value ?? '—'}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-ink">{label}</span>
      <span aria-hidden className="text-ink-muted transition-transform duration-300 group-hover:translate-x-1">→</span>
    </Link>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const positive = value >= 0
  return (
    <span
      aria-label={`${positive ? 'Aumento' : 'Queda'} de ${Math.abs(value).toFixed(0)} por cento`}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${positive ? 'bg-success-pale text-success' : 'bg-danger-pale text-danger'}`}
    >
      <span aria-hidden>{positive ? '↗' : '↘'}</span>
      {Math.abs(value).toFixed(0)}%
    </span>
  )
}

function endOfToday(now: Date): Date {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d
}

function safeGroupCount(groupCount: unknown): number {
  if (groupCount && typeof groupCount === 'object' && '_all' in groupCount) {
    const countObj = groupCount as { _all?: number }
    return countObj._all ?? 0
  }
  return 0
}

export default async function AgentDashboard() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  const downlineIds = getDownlineIds(allAgents, agent.id)
  const scope = [agent.id, ...downlineIds]

  const now = new Date()
  const currentP = periodFromDate(now)
  const previousP = shiftPeriod(currentP, -1)
  const trendStartP = shiftPeriod(currentP, -5)
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  // Work-queue counters (actionable, scoped to the agent + downline).
  let openCases = 0
  let awaitingIllustration = 0
  let openRequirements = 0
  let dueFollowUps = 0
  let dueReviews = 0
  let atRiskPolicies = 0
  let txnExpected = 0
  let txnPaid = 0
  let txnChargeback = 0

  let policyCount = 0
  let commissionTotalAmount = 0
  let commissionThisMonth = 0
  let commissionLastMonth = 0
  let commissionByPeriod: { period: string; total: number }[] = []
  let byStatus: { status: string; _count: { _all: number } }[] = []
  let byCarrier: { carrier: string; _count: { _all: number } }[] = []
  let byProduct: { product: string; _count: { _all: number } }[] = []
  let loadError = false

  try {
    const [
      policyTotal,
      commissionAgg,
      commissionThisMonthAgg,
      commissionLastMonthAgg,
      commissionPeriodBuckets,
      statusBuckets,
      carrierBuckets,
      productBuckets,
      openCasesCount,
      awaitingIllustrationCount,
      openRequirementsCount,
      atRiskCount,
      txnByType,
      dueFollowUpCount,
      dueReviewCount,
    ] = await Promise.all([
      prisma.policy.count({ where: { agentId: agent.id } }),
      prisma.commissionRecord.aggregate({ where: { agentId: agent.id }, _sum: { amount: true } }),
      prisma.commissionRecord.aggregate({ where: { agentId: agent.id, period: currentP }, _sum: { amount: true } }),
      prisma.commissionRecord.aggregate({ where: { agentId: agent.id, period: previousP }, _sum: { amount: true } }),
      prisma.commissionRecord.groupBy({
        by: ['period'],
        where: { agentId: agent.id, period: { gte: trendStartP, lte: currentP } },
        _sum: { amount: true },
        orderBy: { period: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['status'],
        where: { agentId: agent.id },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['carrier'],
        where: { agentId: agent.id },
        _count: { _all: true },
        orderBy: { carrier: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['product'],
        where: { agentId: agent.id },
        _count: { _all: true },
        orderBy: { product: 'asc' },
      }),
      prisma.insuranceCase.count({ where: { assignedAgentId: { in: scope }, status: 'OPEN' } }),
      prisma.insuranceCase.count({ where: { assignedAgentId: { in: scope }, stage: { in: ['DISCOVERY', 'DESIGN'] } } }),
      prisma.applicationRequirement.count({
        where: { status: 'OPEN', application: { insuranceCase: { assignedAgentId: { in: scope } } } },
      }),
      prisma.policy.count({ where: { agentId: agent.id, status: 'LAPSED' } }),
      prisma.commissionTransaction.groupBy({
        by: ['type'],
        where: {
          agentId: agent.id,
          occurredAt: { gte: currentMonthStart, lt: nextMonthStart },
        },
        _sum: { amount: true },
      }),
      prisma.caseTimelineEvent.count({
        where: {
          type: 'FOLLOW_UP',
          doneAt: null,
          dueAt: { lte: endOfToday(now) },
          insuranceCase: { assignedAgentId: { in: scope } },
        },
      }),
      prisma.policyReview.count({
        where: {
          completedAt: null,
          dueAt: { lte: endOfToday(now) },
          policy: { agentId: { in: scope } },
        },
      }),
    ])

    openCases = openCasesCount
    awaitingIllustration = awaitingIllustrationCount
    openRequirements = openRequirementsCount
    atRiskPolicies = atRiskCount
    dueFollowUps = dueFollowUpCount
    dueReviews = dueReviewCount
    for (const t of txnByType) {
      const sum = decimalToNumber(t._sum.amount)
      if (t.type === 'EXPECTED') txnExpected = sum
      else if (t.type === 'PAID') txnPaid = sum
      else if (t.type === 'CHARGEBACK') txnChargeback = sum
    }

    policyCount = policyTotal
    commissionTotalAmount = decimalToNumber(commissionAgg._sum.amount)
    commissionThisMonth = decimalToNumber(commissionThisMonthAgg._sum.amount)
    commissionLastMonth = decimalToNumber(commissionLastMonthAgg._sum.amount)
    commissionByPeriod = commissionPeriodBuckets.map((bucket) => ({
      period: bucket.period,
      total: decimalToNumber(bucket._sum.amount),
    }))
    byStatus = statusBuckets
    byCarrier = carrierBuckets
    byProduct = productBuckets
  } catch (error) {
    console.error('AgentDashboard query error', error)
    loadError = true
  }

  const firstName = ((user?.name ?? '').trim() || 'Agente').split(/\s+/)[0]
  const commissionDelta = loadError ? null : percentChange(commissionThisMonth, commissionLastMonth)
  const commissionTrendMap = new Map(commissionByPeriod.map((bucket) => [bucket.period, bucket.total]))
  const commissionTrend = Array.from({ length: 6 }, (_, index) => {
    const period = shiftPeriod(currentP, index - 5)
    return {
      label: period.slice(5),
      tooltipLabel: new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${period}-01T00:00:00.000Z`)),
      value: commissionTrendMap.get(period) ?? 0,
    }
  })
  const moneyValue = (value: number) => loadError ? '—' : formatCurrency(value)
  const countValue = (value: number) => loadError ? '—' : String(value)
  const pulseMetrics = [
    { label: 'Oportunidades ativas', value: countValue(openCases) },
    { label: 'Comissão esperada', value: moneyValue(txnExpected) },
    { label: 'Apólices', value: countValue(policyCount) },
    { label: 'Equipe', value: countValue(downlineIds.length) },
    { label: 'Revisões', value: countValue(dueReviews) },
  ]
  const signals: OperationSignal[] = loadError ? [] : [
    {
      title: dueFollowUps > 0 ? `${dueFollowUps} retornos podem destravar seu pipeline hoje.` : 'Seu pipeline está pronto para a próxima oportunidade.',
      description: dueFollowUps > 0
        ? 'Comece pelos contatos que já chegaram ao prazo e transforme pendências em avanço real.'
        : 'A fila de contatos está em dia. Use o espaço para abrir uma nova oportunidade.',
      action: dueFollowUps > 0 ? 'Revisar retornos' : 'Novo atendimento',
      href: dueFollowUps > 0 ? '/agent/activities' : '/agent/cases/new',
      tone: 'mint',
    },
    {
      title: atRiskPolicies > 0 ? `${atRiskPolicies} apólices merecem atenção antes da próxima revisão.` : 'Sua carteira não apresenta alertas críticos.',
      description: atRiskPolicies > 0
        ? 'Revise os sinais de risco e planeje um contato proativo antes que a relação com o cliente esfrie.'
        : 'Mantenha o ritmo de acompanhamento para preservar retenção e confiança.',
      action: 'Abrir carteira',
      href: '/agent/policies',
      tone: 'amber',
    },
    {
      title: txnExpected > txnPaid ? 'Existe receita esperada pronta para acompanhamento.' : 'Sua produção está alinhada com os pagamentos registrados.',
      description: txnExpected > txnPaid
        ? `A diferença atual entre o esperado e o pago é de ${formatCurrency(Math.max(0, txnExpected - txnPaid))}.`
        : 'Use o extrato para acompanhar detalhes, repasses e movimentos da sua equipe.',
      action: 'Ver comissões',
      href: '/agent/commissions',
      tone: 'violet',
    },
  ]

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <KeeprDashboardMotion>
        {loadError && (
          <div className="mb-5">
            <ErrorBanner>
              Não foi possível carregar seus dados agora. Os números abaixo podem estar incompletos — tente atualizar a página.
            </ErrorBanner>
          </div>
        )}

        <section
          aria-labelledby="agent-financial-title"
          className="grid min-h-[520px] grid-flow-dense grid-cols-1 overflow-hidden rounded-[30px] bg-rail-strong text-paper shadow-[var(--shadow-overlay)] lg:grid-cols-12"
        >
          <article className="keepr-noise relative flex flex-col overflow-hidden p-7 sm:p-9 lg:col-span-8 lg:p-10">
            <div aria-hidden className="absolute -left-28 -top-32 h-96 w-96 rounded-full bg-mint/14 blur-3xl" />
            <div aria-hidden className="absolute -bottom-28 right-0 h-80 w-80 rounded-full bg-white/[0.035] blur-3xl" />

            <div className="relative flex h-full flex-col">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <p data-hero-reveal className="text-xs font-semibold uppercase tracking-[0.18em] text-mint">
                    Bom dia, {firstName}!
                  </p>
                  <h1
                    id="agent-financial-title"
                    data-hero-reveal
                    className="mt-4 max-w-4xl text-[clamp(2.35rem,4.1vw,4.35rem)] font-medium leading-[0.98] tracking-[-0.06em]"
                  >
                    Estas são suas comissões neste mês.
                  </h1>
                </div>
                <Link
                  data-hero-reveal
                  href="/agent/commissions"
                  className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                >
                  Ver extrato <span aria-hidden>↗</span>
                </Link>
              </div>

              <div data-hero-reveal className="mt-7 flex flex-wrap items-end gap-x-4 gap-y-3">
                <p className="font-mono text-[clamp(3.5rem,6vw,6.25rem)] font-medium leading-[0.84] tracking-[-0.072em] tabular-nums">
                  {moneyValue(commissionThisMonth)}
                </p>
                <div className="pb-1 sm:pb-2">
                  <Delta value={commissionDelta} />
                  <p className="mt-2 text-xs text-paper/48">comparado ao mês anterior</p>
                </div>
              </div>

              <div data-hero-reveal className="mt-7 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-medium text-paper/52">Comissões registradas · 6 meses</p>
                  <p className="font-mono text-xs text-paper/46">Período {currentP}</p>
                </div>
                <TrendChart
                  data={commissionTrend}
                  format="currency"
                  tone="onDark"
                  interactive
                  chartHeight={124}
                  ariaLabel="Comissões registradas nos últimos seis meses"
                />
              </div>

              <div data-hero-reveal className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
                {[
                  { label: 'Esperada', value: txnExpected, tone: 'text-paper' },
                  { label: 'Paga', value: txnPaid, tone: 'text-mint' },
                  { label: 'Chargebacks', value: txnChargeback, tone: 'text-[oklch(0.78_0.12_68)]' },
                ].map((metric) => (
                  <div key={metric.label} className="bg-rail-strong/80 px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/38">{metric.label}</p>
                    <p className={`mt-1.5 font-mono text-lg font-medium tabular-nums ${metric.tone}`}>{moneyValue(metric.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <aside data-hero-reveal className="relative flex flex-col border-t border-border-steel bg-[#f4f4f1] p-6 text-ink sm:p-7 lg:col-span-4 lg:border-l lg:border-t-0 lg:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Sua fila</p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.035em] text-ink">Prioridades de hoje</h2>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rail-strong text-sm font-semibold text-paper">
                {loadError ? '—' : dueFollowUps + openRequirements + atRiskPolicies + dueReviews}
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
              Comece pelo que pode destravar resultado ou proteger sua carteira hoje.
            </p>
            <div className="mt-6 flex flex-col gap-1">
              <PriorityRow href="/agent/activities" label="Retornos pendentes" value={loadError ? null : dueFollowUps} tone="danger" />
              <PriorityRow href="/agent/activities" label="Pendências abertas" value={loadError ? null : openRequirements} tone="amber" />
              <PriorityRow href="/agent/policies" label="Apólices em risco" value={loadError ? null : atRiskPolicies} tone="danger" />
              <PriorityRow href="/agent/policies" label="Revisões anuais" value={loadError ? null : dueReviews} tone="mint" />
            </div>
            <Link href="/agent/activities" className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rail-strong px-4 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5">
              Abrir fila completa
            </Link>
          </aside>
        </section>

        <div className="keepr-marquee-mask mt-6 overflow-hidden border-y border-border-steel/70 bg-paper/56 py-3.5">
          <div className="keepr-marquee-track flex items-center">
            {[...pulseMetrics, ...pulseMetrics].map((metric, index) => (
              <div key={`${metric.label}-${index}`} className="flex shrink-0 items-center gap-3 px-7">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{metric.label}</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-ink">{metric.value}</span>
              </div>
            ))}
          </div>
        </div>

        <section aria-label="Resumo da operação" className="mt-16 grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-12">
          <Link href="/agent/cases" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -bottom-20 -right-12 h-52 w-52 rounded-full bg-teal-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Pipeline</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(openCases)}</p>
                <p className="mt-2 text-sm text-ink-muted">oportunidades ativas em andamento</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">{countValue(awaitingIllustration)} aguardando ilustração</span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
          </Link>

          <Link href="/agent/policies" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Carteira</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(policyCount)}</p>
                <p className="mt-2 text-sm text-ink-muted">apólices sob seu cuidado</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">{countValue(atRiskPolicies)} sinais de risco</span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
          </Link>

          <Link href="/agent/hierarchy" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[oklch(0.91_0.045_286)] transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Rede</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(downlineIds.length)}</p>
                <p className="mt-2 text-sm text-ink-muted">agentes conectados à sua estrutura</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">{moneyValue(commissionTotalAmount)} em comissões</span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
          </Link>
        </section>

        <section className="py-24 sm:py-32" aria-labelledby="portfolio-panorama-title">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-teal-deep">Leitura da carteira</p>
              <h2 id="portfolio-panorama-title" className="mt-3 max-w-4xl text-3xl font-medium tracking-[-0.045em] text-ink sm:text-5xl">
                Panorama sem ruído.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-ink-muted">
              Passe o cursor para aprofundar cada recorte e identificar onde sua carteira está concentrada.
            </p>
          </div>
          <div className="keepr-card flex flex-col overflow-hidden rounded-[28px] md:flex-row" data-stack-card>
            <BreakdownList
              title="Por status"
              rows={byStatus.map((s) => ({ label: policyStatusLabel[s.status] ?? s.status, count: safeGroupCount(s._count) }))}
            />
            <BreakdownList
              title="Por carrier"
              rows={byCarrier.map((c) => ({ label: c.carrier, count: safeGroupCount(c._count) }))}
            />
            <BreakdownList
              title="Por produto"
              rows={byProduct.map((p) => ({ label: p.product, count: safeGroupCount(p._count) }))}
            />
          </div>
        </section>

        <OperationSignals signals={signals} />

        <section className="py-24 sm:py-32">
          <div className="relative overflow-hidden rounded-[32px] bg-mint p-8 text-rail-strong sm:p-12 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div aria-hidden className="absolute -right-12 -top-20 h-64 w-64 rounded-full border-[42px] border-rail-strong/8" />
            <div className="relative max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-rail-strong/55">Mantenha o ritmo</p>
              <h2 className="mt-4 max-w-5xl text-3xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl">
                A próxima oportunidade pode começar agora.
              </h2>
            </div>
            <Link href="/agent/cases/new" className="relative mt-8 inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-rail-strong px-6 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-1 lg:mt-0">
              Novo atendimento
            </Link>
          </div>
        </section>
      </KeeprDashboardMotion>
    </Shell>
  )
}
