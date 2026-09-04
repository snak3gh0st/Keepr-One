export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { loadAdminProduction } from '@/lib/national-life/admin-production'
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

  const { rows, period, periods, source, coverage } = await loadAdminProduction(prisma, periodParam)
  const periodLabel = (value: string) => formatDate(`${value}-01T00:00:00.000Z`, language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return (
    <Shell role="ADMIN" userName={session.user.name}>
      <PageHeader title={copy('Produção por agente', 'Production by agent')} eyebrow={copy('Desempenho', 'Performance')} description={copy('Compare apólices, prêmio e comissão por período.', 'Compare policies, premium, and commission by period.')} />

      <p className="mt-5 text-sm text-ink-muted">{source === 'NATIONAL_LIFE'
        ? copy('Comissão direta: registros auditados da National Life, sem duplicatas entre conectores. Overrides e lançamentos manuais não compõem este total.', 'Direct commission: audited National Life records, deduplicated across connectors. Overrides and manual entries are excluded.')
        : copy('Fonte alternativa: comissões diretas dos registros locais. Nenhuma fonte de comissões National Life está disponível.', 'Fallback source: direct commissions from local records. No National Life commission source is available.')}</p>
      <p className="mt-2 text-sm text-ink-muted">{copy(
        `Cobertura: ${coverage.policiesWithoutEffectiveDate} apólices sem data de vigência, fora dos períodos; ${coverage.unmappedDirectRows} comissões diretas sem NPN correspondente no mês (US$ ${coverage.unmappedDirectAmount.toFixed(2)}); ${coverage.rejectedRows} registros rejeitados na auditoria da fonte (${coverage.missingWritingAgentRows} sem NPN e ${coverage.missingPaymentDateRows} sem data de pagamento).`,
        `Coverage: ${coverage.policiesWithoutEffectiveDate} policies without an effective date, excluded from periods; ${coverage.unmappedDirectRows} direct commissions without a matching NPN this month (US$ ${coverage.unmappedDirectAmount.toFixed(2)}); ${coverage.rejectedRows} records rejected by the source audit (${coverage.missingWritingAgentRows} without NPN and ${coverage.missingPaymentDateRows} without payment date).`,
      )}</p>
      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <div className="mb-4 flex items-baseline justify-between"><h2 className="text-base font-semibold text-ink">{copy('Ranking do período', 'Period ranking')}</h2><span className="text-xs text-ink-muted">{rows.length === 1 ? copy('1 agente', '1 agent') : copy(`${formatNumber(rows.length, language)} agentes`, `${formatNumber(rows.length, language)} agents`)}</span></div>
        <ProductionTable rows={rows} />
        </section>
        <aside className="space-y-5 lg:sticky lg:top-6">
          <form method="GET" className="rounded-lg border border-border-steel bg-paper p-5"><h2 className="text-base font-semibold text-ink">{copy('Filtrar período', 'Filter period')}</h2><p className="mt-1 text-sm text-ink-muted">{copy('Escolha o mês que deseja comparar.', 'Choose the month you want to compare.')}</p><label className="mt-4 flex flex-col gap-2"><span className="text-xs font-semibold text-ink-muted">{copy('Mês', 'Month')}</span><Select name="period" defaultValue={period}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</Select></label><Button type="submit" variant="primary" className="mt-4 w-full">{copy('Aplicar filtro', 'Apply filter')}</Button></form>
          <ContextPanel eyebrow={copy('Leitura', 'Insights')} title={copy('Como usar', 'How to use')}><p>{copy('Apólices e prêmio usam a data de vigência em UTC. A comissão direta usa o mês de pagamento da fonte selecionada.', 'Policies and premium use the effective date in UTC. Direct commission uses the payment month from the selected source.')}</p></ContextPanel>
        </aside>
      </div>
    </Shell>
  )
}
