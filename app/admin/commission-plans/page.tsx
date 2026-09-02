import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/Table'
import { EntityCard, EntityCardList } from '@/components/EntityCard'
import { NewPlanForm } from './NewPlanForm'
import { getServerI18n } from '@/lib/i18n/server'
import { formatNumber } from '@/lib/i18n/format'

export const dynamic = 'force-dynamic'

export default async function CommissionPlansPage() {
  const session = await requireRole('ADMIN')
  const { copy, language } = await getServerI18n()
  const plans = await prisma.commissionPlan.findMany({ orderBy: [{ rank: 'asc' }, { downlineLevel: 'asc' }] })

  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader title={copy('Planos de comissão', 'Commission plans')} eyebrow={copy('Configuração', 'Configuration')} description={copy('Defina os percentuais de sobrecomissão aplicados a cada nível da hierarquia.', 'Set the override percentages applied to each level of the hierarchy.')} />
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <section className="rounded-md border border-border-steel bg-paper p-5">
          <div className="flex items-baseline justify-between gap-4 border-b border-border-steel pb-4"><div><h2 className="text-base font-semibold text-ink">{copy('Regras ativas', 'Active rules')}</h2><p className="mt-1 text-sm text-ink-muted">{plans.length === 1 ? copy('1 regra cadastrada', '1 rule added') : copy(`${formatNumber(plans.length, language)} regras cadastradas`, `${formatNumber(plans.length, language)} rules added`)}</p></div><span className="font-mono text-xs text-ink-muted">{copy('sobrecomissão', 'override')}</span></div>
          <div className="mt-4"><EntityCardList>{plans.map((plan, i) => <EntityCard key={plan.id} index={i}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-teal-pale text-xs font-bold text-teal">{formatNumber(plan.downlineLevel, language)}</span><div className="min-w-0 flex-1"><p className="font-medium text-ink">{plan.rank}</p><p className="text-xs text-ink-muted">{copy('Nível da rede', 'Downline level')}</p></div><span className="shrink-0 font-mono text-lg font-semibold tabular-nums text-teal">{formatNumber(Number(plan.overridePercent), language, { maximumFractionDigits: 2 })}%</span></EntityCard>)}</EntityCardList>{plans.length === 0 && <EmptyState>{copy('Nenhum plano cadastrado ainda.', 'No plans have been added yet.')}</EmptyState>}</div>
        </section>
        <section className="rounded-md border border-border-steel bg-panel p-5 lg:sticky lg:top-6"><h2 className="text-base font-semibold text-ink">{copy('Adicionar regra', 'Add rule')}</h2><p className="mt-1 text-sm text-ink-muted">{copy('Adicione um cargo, nível e percentual de sobrecomissão.', 'Add a rank, level, and override percentage.')}</p><div className="mt-5"><NewPlanForm /></div></section>
      </div>
    </Shell>
  )
}
