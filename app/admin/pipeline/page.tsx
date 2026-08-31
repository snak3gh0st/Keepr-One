export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { buildPipelineFunnel, buildAgentPipeline } from '@/lib/pipeline-bi'
import { buildCycleTimes, type StageTransition } from '@/lib/cycle-time'
import { caseStageTone, type CaseStage } from '@/lib/case-workflow'
import { bucketByMonth } from '@/lib/dashboard'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { TrendChart } from '@/components/TrendChart'
import { AgentPipelineTable } from './AgentPipelineTable'
import { getServerI18n } from '@/lib/i18n/server'
import { formatCurrency, formatNumber } from '@/lib/i18n/format'

const BAR_TONE: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-gold',
  danger: 'bg-danger',
  neutral: 'bg-teal',
}

export default async function PipelinePage() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const usd = (value: number) => formatCurrency(value, language, 'USD', {
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const stageLabels: Record<CaseStage, string> = {
    LEAD: 'Lead',
    DISCOVERY: copy('Descoberta', 'Discovery'),
    DESIGN: copy('Desenho', 'Design'),
    ILLUSTRATION_READY: copy('Ilustração pronta', 'Illustration ready'),
    APPLICATION_STARTED: copy('Aplicação iniciada', 'Application started'),
    SUBMITTED: copy('Enviado', 'Submitted'),
    UNDERWRITING: copy('Em análise', 'Underwriting'),
    APPROVED: copy('Aprovado', 'Approved'),
    ISSUED: copy('Emitido', 'Issued'),
    PLACED: copy('Em vigor', 'Active'),
    DECLINED: copy('Recusado', 'Declined'),
    WITHDRAWN: copy('Retirado', 'Withdrawn'),
  }

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
        title={copy('Funil de casos', 'Case pipeline')}
        eyebrow={copy('Gestão', 'Management')}
        description={copy('Visão executiva do funil de casos, conversão e valor em andamento.', 'Executive view of the case funnel, conversion, and value in progress.')}
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={copy('Total de casos', 'Total cases')} value={formatNumber(funnel.total, language)} />
        <StatCard label={copy('Em andamento', 'In progress')} value={formatNumber(funnel.open, language)} />
        <StatCard label={copy('Taxa de conversão', 'Win rate')} value={`${formatNumber(funnel.winRate * 100, language, { maximumFractionDigits: 0 })}%`} emphasis />
        <StatCard label={copy('Emitidos', 'Issued')} value={formatNumber(funnel.placed, language)} />
        <StatCard label={copy('Cobertura no funil', 'Coverage in pipeline')} value={usd(funnel.inFlightCoverage)} />
        <StatCard label={copy('Orçamento mensal no funil', 'Monthly budget in pipeline')} value={`${usd(funnel.inFlightBudget)}${copy('/mês', '/mo')}`} />
        <StatCard label={copy('Recusados', 'Declined')} value={formatNumber(funnel.declined, language)} />
        <StatCard label={copy('Retirados', 'Withdrawn')} value={formatNumber(funnel.withdrawn, language)} />
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-border-steel bg-paper p-6">
          <h2 className="text-base font-semibold text-ink">{copy('Funil por etapa', 'Funnel by stage')}</h2>
          <ul className="mt-5 space-y-2.5">
            {funnel.byStage.map((s) => (
              <li key={s.stage} className="grid grid-cols-[150px_1fr_2.5rem] items-center gap-3">
                <span className="text-sm text-ink-muted">{stageLabels[s.stage]}</span>
                <div className="h-5 rounded bg-panel">
                  <div
                    className={`h-5 rounded ${BAR_TONE[caseStageTone(s.stage)]}`}
                    style={{ width: `${Math.round((s.count / maxStage) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-mono text-sm tabular-nums text-ink">{formatNumber(s.count, language)}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="rounded-lg border border-border-steel bg-paper p-6">
          <h2 className="text-base font-semibold text-ink">{copy('Novos casos por mês', 'New cases by month')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{copy('Últimos 6 meses.', 'Last 6 months.')}</p>
          <div className="mt-4">
            <TrendChart
              data={trend}
              format="count"
              ariaLabel={copy('Novos casos nos últimos seis meses', 'New cases in the last six months')}
            />
          </div>
        </aside>
      </div>

      <section className="mt-8 rounded-lg border border-border-steel bg-paper p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{copy('Tempo médio por etapa', 'Average time by stage')}</h2>
          <span className="text-xs text-ink-muted">{copy('Dias entre entrar e sair da etapa', 'Days between entering and leaving the stage')}</span>
        </div>
        {cycleTimes.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            {copy('Ainda sem transições registradas para medir. O tempo por etapa aparece conforme os casos avançam.', 'There are no recorded transitions to measure yet. Time by stage will appear as cases progress.')}
          </p>
        ) : (
          <ul className="mt-5 space-y-2.5">
            {cycleTimes.map((s) => (
              <li key={s.stage} className="grid grid-cols-[150px_1fr_5rem] items-center gap-3">
                <span className="text-sm text-ink-muted">{stageLabels[s.stage]}</span>
                <div className="h-5 rounded bg-panel">
                  <div
                    className="h-5 rounded bg-teal"
                    style={{ width: `${Math.round((s.avgDays / maxCycle) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-mono text-sm tabular-nums text-ink">
                  {formatNumber(s.avgDays, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{copy('d', 'd')}
                  <span className="ml-1 text-xs text-ink-muted">·{formatNumber(s.samples, language)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{copy('Funil por agente', 'Pipeline by agent')}</h2>
          <span className="text-xs text-ink-muted">{agentRows.length === 1 ? copy('1 agente com casos', '1 agent with cases') : copy(`${formatNumber(agentRows.length, language)} agentes com casos`, `${formatNumber(agentRows.length, language)} agents with cases`)}</span>
        </div>
        <AgentPipelineTable rows={agentRows} />
      </section>
    </Shell>
  )
}
