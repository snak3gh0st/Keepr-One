export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { buildPipelineFunnel, buildAgentPipeline } from '@/lib/pipeline-bi'
import { buildCycleTimes, type StageTransition } from '@/lib/cycle-time'
import { caseStageLabel, caseStageTone, type CaseStage } from '@/lib/case-workflow'
import { bucketByMonth } from '@/lib/dashboard'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { TrendChart } from '@/components/TrendChart'
import { Table, Thead, Th, Tr, Td, TdNum, EmptyState } from '@/components/Table'

const usd = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v.toFixed(0)}`

const BAR_TONE: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-gold',
  danger: 'bg-danger',
  neutral: 'bg-teal',
}

export default async function PipelinePage() {
  const session = await requireRole('ADMIN')

  const cases = await prisma.insuranceCase.findMany({
    select: {
      stage: true,
      targetCoverage: true,
      monthlyBudget: true,
      createdAt: true,
      assignedAgentId: true,
      assignedAgent: { select: { user: { select: { name: true } } } },
      timelineEvents: {
        where: { type: 'STAGE_CHANGED' },
        select: { createdAt: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  const funnel = buildPipelineFunnel(
    cases.map((c) => ({
      stage: c.stage,
      targetCoverage: c.targetCoverage?.toNumber() ?? null,
      monthlyBudget: c.monthlyBudget?.toNumber() ?? null,
    })),
  )

  // Only events carrying structured from/to feed cycle time; older events (pre
  // metadata) are skipped rather than parsed from labels.
  const cycleTimes = buildCycleTimes(
    cases.map((c) => ({
      createdAt: c.createdAt,
      transitions: c.timelineEvents.flatMap((e): StageTransition[] => {
        const m = e.metadata as { from?: CaseStage; to?: CaseStage } | null
        return m?.from && m?.to ? [{ from: m.from, to: m.to, at: e.createdAt }] : []
      }),
    })),
  )
  const maxCycle = Math.max(1, ...cycleTimes.map((c) => c.avgDays))

  const agentRows = buildAgentPipeline(
    cases.map((c) => ({
      agentId: c.assignedAgentId,
      agentName: c.assignedAgent.user?.name ?? '—',
      stage: c.stage,
      targetCoverage: c.targetCoverage?.toNumber() ?? null,
      monthlyBudget: c.monthlyBudget?.toNumber() ?? null,
    })),
  )

  const trend = bucketByMonth(cases.map((c) => c.createdAt), 6, new Date()).map((b) => ({
    label: b.month.slice(5),
    value: b.count,
  }))

  const maxStage = Math.max(1, ...funnel.byStage.map((s) => s.count))

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader
        title="Pipeline de casos"
        eyebrow="Gestão"
        description="Visão executiva do funil de casos, conversão e valor em andamento."
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total de casos" value={funnel.total} />
        <StatCard label="Em andamento" value={funnel.open} />
        <StatCard label="Win rate" value={`${(funnel.winRate * 100).toFixed(0)}%`} emphasis />
        <StatCard label="Emitidos" value={funnel.placed} />
        <StatCard label="Cobertura em pipeline" value={usd(funnel.inFlightCoverage)} />
        <StatCard label="Orçamento mensal em pipeline" value={`${usd(funnel.inFlightBudget)}/m`} />
        <StatCard label="Recusados" value={funnel.declined} />
        <StatCard label="Retirados" value={funnel.withdrawn} />
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-border-steel bg-paper p-6">
          <h2 className="text-base font-semibold text-ink">Funil por etapa</h2>
          <ul className="mt-5 space-y-2.5">
            {funnel.byStage.map((s) => (
              <li key={s.stage} className="grid grid-cols-[150px_1fr_2.5rem] items-center gap-3">
                <span className="text-sm text-ink-muted">{caseStageLabel[s.stage]}</span>
                <div className="h-5 rounded bg-panel">
                  <div
                    className={`h-5 rounded ${BAR_TONE[caseStageTone(s.stage)]}`}
                    style={{ width: `${Math.round((s.count / maxStage) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-mono text-sm tabular-nums text-ink">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="rounded-lg border border-border-steel bg-paper p-6">
          <h2 className="text-base font-semibold text-ink">Novos casos por mês</h2>
          <p className="mt-1 text-sm text-ink-muted">Últimos 6 meses.</p>
          <div className="mt-4">
            <TrendChart data={trend} format="count" />
          </div>
        </aside>
      </div>

      <section className="mt-8 rounded-lg border border-border-steel bg-paper p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">Tempo médio por etapa</h2>
          <span className="text-xs text-ink-muted">Dias entre entrar e sair da etapa</span>
        </div>
        {cycleTimes.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            Ainda sem transições registradas para medir. O tempo por etapa aparece conforme os casos avançam.
          </p>
        ) : (
          <ul className="mt-5 space-y-2.5">
            {cycleTimes.map((s) => (
              <li key={s.stage} className="grid grid-cols-[150px_1fr_5rem] items-center gap-3">
                <span className="text-sm text-ink-muted">{caseStageLabel[s.stage]}</span>
                <div className="h-5 rounded bg-panel">
                  <div
                    className="h-5 rounded bg-teal"
                    style={{ width: `${Math.round((s.avgDays / maxCycle) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-mono text-sm tabular-nums text-ink">
                  {s.avgDays.toFixed(1)}d
                  <span className="ml-1 text-xs text-ink-muted">·{s.samples}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">Pipeline por agente</h2>
          <span className="text-xs text-ink-muted">{agentRows.length} agentes com casos</span>
        </div>
        <Table>
          <Thead>
            <tr>
              <Th>Agente</Th>
              <Th className="text-right">Em andamento</Th>
              <Th className="text-right">Emitidos</Th>
              <Th className="text-right">Win rate</Th>
              <Th className="text-right">Cobertura em pipeline</Th>
            </tr>
          </Thead>
          <tbody>
            {agentRows.map((r, i) => (
              <Tr key={r.agentId} index={i}>
                <Td>{r.agentName}</Td>
                <TdNum>{r.open}</TdNum>
                <TdNum>{r.placed}</TdNum>
                <TdNum>{(r.winRate * 100).toFixed(0)}%</TdNum>
                <TdNum>{usd(r.inFlightCoverage)}</TdNum>
              </Tr>
            ))}
          </tbody>
        </Table>
        {agentRows.length === 0 && <EmptyState>Nenhum caso atribuído ainda.</EmptyState>}
      </section>
    </Shell>
  )
}
