import type { PremiumEvolution } from '@/lib/national-life/premium-evolution'

export function NationalPremiumEvolution({ model, language, preservedParams = {} }: {
  model: PremiumEvolution
  language: string
  preservedParams?: Record<string, string>
}) {
  const pt = language === 'PT'
  const copy = (portuguese: string, english: string) => pt ? portuguese : english
  const locale = pt ? 'pt-BR' : 'en-US'
  const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value)
  const compact = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const monthLabel = (month: string) => `${new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))}/${month.slice(2, 4)}`
  const values = model.months.map((month) => model.view === 'monthly' ? month.value : month.cumulative)
  const max = Math.max(1, ...values.filter((value): value is number => value !== null)) * 1.15
  const width = Math.max(660, model.range * 64 + 100)
  const left = 76, right = width - 24, top = 24, bottom = 220
  const step = (right - left) / model.range
  const x = (index: number) => left + step * (index + 0.5)
  const horizontal = (value: number) => `${value / width * 100}%`
  const y = (value: number) => bottom - value / max * (bottom - top)
  const control = 'min-h-11 rounded-full border border-white/15 bg-rail px-4 text-sm text-paper scheme-dark transition-colors hover:border-mint/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint'
  return (
    <section id="premium-evolution" aria-labelledby="premium-evolution-title" className="keepr-noise relative mt-6 min-w-0 overflow-hidden rounded-[30px] border border-white/10 bg-rail-strong p-5 text-paper shadow-[var(--shadow-overlay)] sm:p-8 lg:p-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-mint">{copy('Sua carteira', 'Your book')} · National Life</p>
          <h2 id="premium-evolution-title" className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.04em] text-paper sm:text-4xl">{copy('Prêmio anual previsto', 'Expected annual premium')}</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-paper/65">{copy('Evolução por mês de emissão. Valor anual atual das apólices, não pagamentos recebidos.', 'Evolution by issue month. Current annual policy amounts, not payments received.')}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/55">{copy('Total no período selecionado', 'Total in selected period')} · USD</p>
          <p className="mt-3 font-mono text-2xl font-medium tracking-tight tabular-nums text-mint sm:text-3xl">{money(model.total)}</p>
        </div>
      </div>
      <form action="/agent#premium-evolution" method="get" className="mt-7 flex flex-wrap items-end gap-3 border-y border-white/10 py-5">
        {Object.entries(preservedParams).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="flex flex-col gap-2 text-[11px] text-paper/65">{copy('Período', 'Period')}
          <select name="premiumRange" defaultValue={String(model.range)} className={control}>{[6, 12, 24].map((range) => <option key={range} value={range}>{range} {copy('meses', 'months')}</option>)}</select>
        </label>
        <label className="flex min-w-0 flex-col gap-2 text-[11px] text-paper/65">{copy('Produto', 'Product')}
          <select name="premiumProduct" defaultValue={model.product} className={`${control} max-w-full`}><option value="">{copy('Todos os produtos', 'All products')}</option>{model.products.map((product) => <option key={product} value={product}>{product}</option>)}</select>
        </label>
        <label className="flex flex-col gap-2 text-[11px] text-paper/65">{copy('Visualização', 'View')}
          <select name="premiumView" defaultValue={model.view} className={control}>
            <option value="monthly">{copy('Mensal', 'Monthly')}</option><option value="cumulative">{copy('Acumulado no período', 'Cumulative in period')}</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-full bg-mint px-5 text-sm font-semibold text-rail-strong transition-colors hover:bg-paper active:bg-mint/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mint">{copy('Aplicar', 'Apply')}</button>
      </form>
      {!model.available ? <p role="status" className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-sm text-paper/70">{copy('Aguardando exportação completa e consistente da National para mostrar o gráfico.', 'Waiting for a complete, consistent National export to display the chart.')}</p> : <>
        <div className="mt-7 overflow-x-auto rounded-xl text-paper/75 scheme-dark focus-visible:outline-2 focus-visible:outline-mint" tabIndex={0} role="region" aria-label={copy('Gráfico de prêmio anual previsto; role horizontalmente para ver todos os meses', 'Expected annual premium chart; scroll horizontally to see all months')}>
          <svg className="font-mono tabular-nums" width="100%" style={{ minWidth: width }} height="270" role="img" aria-labelledby="premium-chart-title" aria-describedby="premium-chart-description">
            <title id="premium-chart-title">{copy('Prêmio anual previsto em dólares por mês de emissão', 'Expected annual premium in dollars by issue month')}</title>
            <desc id="premium-chart-description">{copy('Valores exatos na tabela abaixo. Traços indicam dados incompletos. O último mês é parcial.', 'Exact values in the table below. Dashes indicate incomplete data. The last month is partial.')}</desc>
            {[0, 0.5, 1].map((fraction) => <g key={fraction}>
              <line x1={horizontal(left)} x2={horizontal(right)} y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" opacity="0.12" />
              <text x={horizontal(left - 10)} y={y(max * fraction) + 4} textAnchor="end" fontSize="11" fill="currentColor">{compact(max * fraction)}</text>
            </g>)}
            {values.map((value, index) => <g key={model.months[index].month}>
              {value !== null && model.view === 'monthly' && <rect x={horizontal(x(index) - step * 0.28)} y={y(value)} width={horizontal(step * 0.56)} height={bottom - y(value)} rx="3" fill="var(--color-mint)" opacity={index === values.length - 1 ? 0.45 : 0.85} />}
              {value !== null && model.view === 'cumulative' && <>
                {index > 0 && values[index - 1] !== null && <line x1={horizontal(x(index - 1))} y1={y(values[index - 1]!)} x2={horizontal(x(index))} y2={y(value)} stroke="var(--color-mint)" strokeWidth="3" />}
                <circle cx={horizontal(x(index))} cy={y(value)} r="4" fill="var(--color-mint)" />
              </>}
              <text x={horizontal(x(index))} y={value === null ? bottom - 10 : y(value) - 9} textAnchor="middle" fontSize="11" fill="currentColor">{value === null ? '—' : compact(value)}</text>
              <text x={horizontal(x(index))} y={bottom + 24} textAnchor="middle" fontSize="11" fill="currentColor">{monthLabel(model.months[index].month)}{index === values.length - 1 ? '*' : ''}</text>
            </g>)}
          </svg>
        </div>
        <p className="mt-3 text-xs text-paper/65">{copy(`${model.known}/${model.policies} apólices no período com prêmio anual informado.`, `${model.known}/${model.policies} policies in the period have annual premium data.`)} {model.undated > 0 && copy(`${model.undated} apólices sem data válida; totais bloqueados.`, `${model.undated} policies have no valid date; totals withheld.`)}</p>
        {model.futureDated > 0 && <p className="mt-2 text-xs text-paper/65">{copy(`${model.futureDated} apólices com emissão futura na National não entram na evolução até a data da exportação.`, `${model.futureDated} policies with future issue dates in National are excluded from evolution through the export date.`)}</p>}
        <details className="mt-5 border-y border-white/10">
          <summary className="min-h-11 cursor-pointer py-4 text-sm font-medium text-mint transition-colors hover:text-paper focus-visible:outline-2 focus-visible:outline-mint">{copy('Ver valores e cobertura por mês', 'View monthly values and coverage')}</summary>
          <div className="overflow-x-auto scheme-dark"><table className="w-full text-left text-sm tabular-nums text-paper/80">
            <caption className="sr-only">{copy('Prêmio anual previsto por mês de emissão, em dólares', 'Expected annual premium by issue month, in USD')}</caption>
            <thead><tr>{[copy('Emissão', 'Issue month'), copy('Apólices com valor', 'Policies with values'), copy('Prêmio anual (USD)', 'Annual premium (USD)'), copy('Acumulado (USD)', 'Cumulative (USD)')].map((label) => <th key={label} scope="col" className="whitespace-nowrap border-b border-white/15 px-3 py-3 text-xs font-medium text-paper/60">{label}</th>)}</tr></thead>
            <tbody>{model.months.map((month, index) => <tr key={month.month} className="border-b border-white/10"><th scope="row" className="whitespace-nowrap px-3 py-3 font-normal">{monthLabel(month.month)}{index === model.months.length - 1 ? '*' : ''}</th><td className="px-3 py-3 font-mono text-xs">{month.known}/{month.policies}</td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{money(month.value)}</td><td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{money(month.cumulative)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
      <p className="mt-5 max-w-4xl text-[11px] leading-5 text-paper/60">{copy('Fonte: campo AAP (Anticipated Annual Premium) da exportação INFORCE CLIENTS da National. Inclui todos os status, inclusive lapsed e canceled. Não representa pagamentos recebidos, Target Premium, comissões nem o saldo histórico da carteira. Apólices ausentes da exportação não entram. Acumulado considera somente o período selecionado.', 'Source: AAP (Anticipated Annual Premium) field in the National INFORCE CLIENTS export. Includes all statuses, including lapsed and canceled. This is not payments received, Target Premium, commissions, or historical book balances. Policies absent from the export are excluded. Cumulative includes only the selected period.')} {model.observedAt && copy(`* Último mês parcial. Fonte consultada em ${new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(model.observedAt)} (UTC).`, `* Last month is partial. Source observed on ${new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(model.observedAt)} (UTC).`)}</p>
    </section>
  )
}
