"use client"

import { useI18n } from '@/components/i18n/LanguageProvider'
import { NationalLifePolicyRefreshButton } from './NationalLifePolicyRefreshButton'

export type NationalLifePolicyDetailCardValue = {
  totalFaceAmount: string | null
  netDeathBenefit: string | null
  plannedPeriodicPayment: string | null
  paymentFrequency: string | null
  anticipatedAnnualPremium: string | null
  targetPremium: string | null
  observedAt: string
}

function money(value: string | null, locale: string): string {
  return value === null ? '—' : new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(Number(value))
}

export function NationalLifePolicyDetailCard({
  detail,
  refresh,
}: {
  detail: NationalLifePolicyDetailCardValue | null
  refresh?: { policyId: string; extensionId: string }
}) {
  const { copy, locale } = useI18n()
  if (!detail) {
    return (
      <section className="module-main-surface">
        <h2 className="text-base font-semibold text-ink">{copy('Dados da National Life', 'National Life data')}</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {copy('A National Life disponibiliza cobertura e pagamentos no detalhe da apólice. Esses campos ainda não foram sincronizados para esta apólice.', 'National Life provides coverage and payment information in the policy details. These fields have not been synced for this policy yet.')}
        </p>
        {refresh && <NationalLifePolicyRefreshButton {...refresh} />}
      </section>
    )
  }

  return (
    <section className="module-main-surface">
      <h2 className="text-base font-semibold text-ink">{copy('Dados da National Life', 'National Life data')}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{copy('Capital segurado', 'Face amount')}</dt>
          <dd className="font-mono text-ink">{money(detail.totalFaceAmount, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{copy('Benefício líquido', 'Net death benefit')}</dt>
          <dd className="font-mono text-ink">{money(detail.netDeathBenefit, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{copy('Pagamento planejado', 'Planned payment')}</dt>
          <dd className="font-mono text-ink">
            {money(detail.plannedPeriodicPayment, locale)}
            {detail.paymentFrequency ? ` · ${detail.paymentFrequency}` : ''}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">{copy('Prêmio anual antecipado', 'Anticipated annual premium')}</dt>
          <dd className="font-mono text-ink">{money(detail.anticipatedAnnualPremium, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Target Premium / CTP</dt>
          <dd className="font-mono text-ink">{money(detail.targetPremium, locale)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-muted">
        {copy('Fonte: detalhe da apólice na National Life · atualizado em', 'Source: National Life policy details · updated on')}{' '}
        {new Date(detail.observedAt).toLocaleString(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/New_York',
        })}.
      </p>
      {refresh && <NationalLifePolicyRefreshButton {...refresh} />}
    </section>
  )
}
