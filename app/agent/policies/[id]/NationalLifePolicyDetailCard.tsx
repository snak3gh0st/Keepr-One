export type NationalLifePolicyDetailCardValue = {
  totalFaceAmount: string | null
  netDeathBenefit: string | null
  plannedPeriodicPayment: string | null
  paymentFrequency: string | null
  anticipatedAnnualPremium: string | null
  observedAt: string
}

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function money(value: string | null): string {
  return value === null ? '—' : MONEY.format(Number(value))
}

export function NationalLifePolicyDetailCard({
  detail,
  refresh,
}: {
  detail: NationalLifePolicyDetailCardValue | null
  refresh?: { policyId: string; extensionId: string }
}) {
  if (!detail) {
    return (
      <section className="module-main-surface">
        <h2 className="text-base font-semibold text-ink">Dados da National Life</h2>
        <p className="mt-2 text-sm text-ink-muted">
          A National Life disponibiliza cobertura e pagamentos no detalhe da apólice.
          Esses campos ainda não foram sincronizados para esta apólice.
        </p>
        {refresh && <NationalLifePolicyRefreshButton {...refresh} />}
      </section>
    )
  }

  return (
    <section className="module-main-surface">
      <h2 className="text-base font-semibold text-ink">Dados da National Life</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Capital segurado</dt>
          <dd className="font-mono text-ink">{money(detail.totalFaceAmount)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Benefício líquido</dt>
          <dd className="font-mono text-ink">{money(detail.netDeathBenefit)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Pagamento planejado</dt>
          <dd className="font-mono text-ink">
            {money(detail.plannedPeriodicPayment)}
            {detail.paymentFrequency ? ` · ${detail.paymentFrequency}` : ''}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Prêmio anual antecipado</dt>
          <dd className="font-mono text-ink">{money(detail.anticipatedAnnualPremium)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        Fonte: detalhe da apólice na National Life · atualizado em{' '}
        {new Date(detail.observedAt).toLocaleString('pt-BR', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        })}.
      </p>
      {refresh && <NationalLifePolicyRefreshButton {...refresh} />}
    </section>
  )
}
import { NationalLifePolicyRefreshButton } from './NationalLifePolicyRefreshButton'
