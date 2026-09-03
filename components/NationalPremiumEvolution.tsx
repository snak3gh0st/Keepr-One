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
  const control = 'min-h-11 rounded-xl border border-ink/20 bg-paper px-3 text-sm text-ink'
  return (
    <section id="premium-evolution" aria-labelledby="premium-evolution-title" className="mt-6 min-w-0 rounded-[28px] border border-ink/10 bg-paper p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/60">National Life · USD</p>
          <h2 id="premium-evolution-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">{copy('AAP por mês de emissão', 'AAP by issue month')}</h2>
          <p className="mt-2 max-w-3xl text-sm text-ink/70">{copy('Prêmio anual antecipado atual das apólices, agrupado pela data de emissão. Inclui todos os status da exportação atual, inclusive lapsed e canceled.', 'Current anticipated annual premium of policies, grouped by issue date. Includes every status in the current export, including lapsed and canceled.')}</p>
        </div>
        <div>
          <p className="text-xs text-ink/60">{copy('AAP no período selecionado', 'AAP in selected period')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{money(model.total)}</p>
        </div>
      </div>
      <form action="/agent#premium-evolution" method="get" className="mt-6 flex flex-wrap items-end gap-3">
        {Object.entries(preservedParams).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="flex flex-col gap-1 text-xs text-ink/70">{copy('Período', 'Period')}
          <select name="premiumRange" defaultValue={String(model.range)} className={control}>{[6, 12, 24].map((range) => <option key={range} value={range}>{range} {copy('meses', 'months')}</option>)}</select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-ink/70">{copy('Produto', 'Product')}
          <select name="premiumProduct" defaultValue={model.product} className={`${control} max-w-full`}><option value="">{copy('Todos os produtos', 'All products')}</option>{model.products.map((product) => <option key={product} value={product}>{product}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink/70">{copy('Visualização', 'View')}
          <select name="premiumView" defaultValue={model.view} className={control}>
            <option value="monthly">{copy('Mensal', 'Monthly')}</option><option value="cumulative">{copy('Acumulado no período', 'Cumulative in period')}</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper">{copy('Aplicar', 'Apply')}</button>
      </form>
      {!model.available ? <p role="status" className="mt-6 text-sm text-ink/70">{copy('Aguardando exportação completa e consistente da National para mostrar o gráfico.', 'Waiting for a complete, consistent National export to display the chart.')}</p> : <>
        <div className="mt-6 overflow-x-auto rounded-xl focus-visible:outline focus-visible:outline-2" tabIndex={0} role="region" aria-label={copy('Gráfico de AAP; role horizontalmente para ver todos os meses', 'AAP chart; scroll horizontally to see all months')}>
          <svg width="100%" style={{ minWidth: width }} height="270" role="img" aria-labelledby="premium-chart-title" aria-describedby="premium-chart-description">
            <title id="premium-chart-title">{copy('AAP em dólares por mês de emissão', 'AAP in dollars by issue month')}</title>
            <desc id="premium-chart-description">{copy('Valores exatos na tabela abaixo. Traços indicam dados incompletos. O último mês é parcial.', 'Exact values in the table below. Dashes indicate incomplete data. The last month is partial.')}</desc>
            {[0, 0.5, 1].map((fraction) => <g key={fraction}>
              <line x1={horizontal(left)} x2={horizontal(right)} y1={y(max * fraction)} y2={y(max * fraction)} stroke="currentColor" opacity="0.12" />
              <text x={horizontal(left - 10)} y={y(max * fraction) + 4} textAnchor="end" fontSize="11" fill="currentColor">{compact(max * fraction)}</text>
            </g>)}
            {values.map((value, index) => <g key={model.months[index].month}>
              {value !== null && model.view === 'monthly' && <rect x={horizontal(x(index) - step * 0.28)} y={y(value)} width={horizontal(step * 0.56)} height={bottom - y(value)} rx="3" fill="#176b4a" opacity={index === values.length - 1 ? 0.6 : 1} />}
              {value !== null && model.view === 'cumulative' && <>
                {index > 0 && values[index - 1] !== null && <line x1={horizontal(x(index - 1))} y1={y(values[index - 1]!)} x2={horizontal(x(index))} y2={y(value)} stroke="#176b4a" strokeWidth="3" />}
                <circle cx={horizontal(x(index))} cy={y(value)} r="4" fill="#176b4a" />
              </>}
              <text x={horizontal(x(index))} y={value === null ? bottom - 10 : y(value) - 9} textAnchor="middle" fontSize="11" fill="currentColor">{value === null ? '—' : compact(value)}</text>
              <text x={horizontal(x(index))} y={bottom + 24} textAnchor="middle" fontSize="11" fill="currentColor">{monthLabel(model.months[index].month)}{index === values.length - 1 ? '*' : ''}</text>
            </g>)}
          </svg>
        </div>
        <p className="mt-2 text-xs text-ink/70">{copy(`${model.known}/${model.policies} apólices no período com AAP informado.`, `${model.known}/${model.policies} policies in the period have AAP.`)} {model.undated > 0 && copy(`${model.undated} apólices sem data válida; totais bloqueados.`, `${model.undated} policies have no valid date; totals withheld.`)}</p>
        {model.futureDated > 0 && <p className="mt-2 text-xs text-ink/70">{copy(`${model.futureDated} apólices com emissão futura na National não entram na evolução até a data da exportação.`, `${model.futureDated} policies with future issue dates in National are excluded from evolution through the export date.`)}</p>}
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink">{copy('Ver valores e cobertura por mês', 'View monthly values and coverage')}</summary>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
            <caption className="sr-only">{copy('AAP atual por mês de emissão, em dólares', 'Current AAP by issue month, in USD')}</caption>
            <thead><tr>{[copy('Emissão', 'Issue month'), copy('Apólices com AAP', 'Policies with AAP'), 'AAP (USD)', copy('Acumulado (USD)', 'Cumulative (USD)')].map((label) => <th key={label} scope="col" className="whitespace-nowrap border-b border-ink/15 px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{model.months.map((month, index) => <tr key={month.month} className="border-b border-ink/10"><th scope="row" className="whitespace-nowrap px-3 py-3 font-normal">{monthLabel(month.month)}{index === model.months.length - 1 ? '*' : ''}</th><td className="px-3 py-3">{month.known}/{month.policies}</td><td className="whitespace-nowrap px-3 py-3">{money(month.value)}</td><td className="whitespace-nowrap px-3 py-3">{money(month.cumulative)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
      <p className="mt-4 max-w-4xl text-xs leading-relaxed text-ink/70">{copy('Fonte: exportação INFORCE CLIENTS da National. Não representa pagamentos recebidos, Target Premium, comissões nem o saldo histórico da carteira. Apólices ausentes da exportação não entram. Acumulado considera somente o período selecionado.', 'Source: National INFORCE CLIENTS export. This is not payments received, Target Premium, commissions, or historical book balances. Policies absent from the export are excluded. Cumulative includes only the selected period.')} {model.observedAt && copy(`* Último mês parcial. Fonte consultada em ${new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(model.observedAt)} (UTC).`, `* Last month is partial. Source observed on ${new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(model.observedAt)} (UTC).`)}</p>
    </section>
  )
}
