"use client"

import { useI18n } from '@/components/i18n/LanguageProvider'
import type { PolicyBookParty, PolicyBookSummary } from '@/lib/national-life/policy-book-summary'

function money(value: string | null, locale: string): string | null {
  if (value === null) return null
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(amount)
}

function Row({ label, value }: { label: string; value: string | null }) {
  // Campo ausente não vira traço: a apólice já passou tempo demais sendo uma
  // ficha de "—". O que a seguradora não mandou simplesmente não ocupa linha.
  if (value === null) return null
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  )
}

function Party({ title, party }: { title: string; party: PolicyBookParty }) {
  const { copy } = useI18n()
  if (!party.name && !party.email && !party.phone && !party.address) return null
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <dl className="mt-2 space-y-2 text-sm">
        <Row label={copy('Nome', 'Name')} value={party.name} />
        <Row label={copy('E-mail', 'Email')} value={party.email} />
        <Row label={copy('Telefone', 'Phone')} value={party.phone} />
        <Row label={copy('Endereço', 'Address')} value={party.address} />
      </dl>
    </div>
  )
}

export function NationalLifeBookCard({ summary }: { summary: PolicyBookSummary | null }) {
  const { copy, locale } = useI18n()
  if (!summary || !summary.hasAnything) return null

  const asOf = new Date(summary.asOf).toLocaleDateString(locale, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <section className="module-main-surface">
      <h2 className="text-base font-semibold text-ink">
        {copy('A apólice na National Life', 'This policy at National Life')}
      </h2>

      <dl className="mt-3 space-y-2 text-sm">
        <Row label={copy('Produto', 'Product')} value={summary.policy.productName} />
        <Row label={copy('Situação', 'Status')} value={summary.policy.status} />
        <Row label={copy('Emissão', 'Issue date')} value={summary.policy.issueDate} />
        <Row label={copy('Fim do período nivelado', 'End of level period')} value={summary.policy.levelPeriodEndDate} />
        <Row label={copy('Conversão até', 'Conversion until')} value={summary.policy.termConversionDate} />
        <Row label={copy('Empregador', 'Employer')} value={summary.policy.employerName} />
        <Row
          label={copy('Prêmio anual antecipado', 'Anticipated annual premium')}
          value={money(summary.money.anticipatedAnnualPremium, locale)}
        />
        <Row label={copy('Prêmio alvo', 'Target premium')} value={money(summary.money.targetPremium, locale)} />
        <Row label={copy('Valor em conta', 'Accumulated cash value')} value={money(summary.money.accumulatedCashValue, locale)} />
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Party title={copy('Segurado', 'Insured')} party={summary.insured} />
        <Party title={copy('Titular', 'Owner')} party={summary.owner} />
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        {copy(
          'Conforme a National Life em {date}. Nenhum valor desta ficha é calculado pela Keepr One.',
          'As reported by National Life on {date}. No value here is calculated by Keepr One.',
          { date: asOf },
        )}
      </p>
    </section>
  )
}
