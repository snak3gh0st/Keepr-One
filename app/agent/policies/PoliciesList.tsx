'use client'

import Link from 'next/link'
import { EmptyState } from '@/components/Table'
import { ContextPanel } from '@/components/ContextPanel'
import { PolicyStatusPill, policyStatusLabel } from '@/components/StatusPill'
import { useI18n } from '@/components/i18n/LanguageProvider'
import type {
  PolicyDirectoryFilters,
  PolicyDirectoryItem,
  PolicyDirectorySummary,
  PolicyDirectorySort,
} from '@/lib/national-life/policy-directory'

const STATUS_ORDER = [
  'INFORCE',
  'PENDING_LAPSE',
  'APPROVED',
  'PENDING',
  'LAPSED',
  'CANCELLED',
]

function formatPremium(value: string | null, formatter: Intl.NumberFormat) {
  if (value === null) return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? formatter.format(amount) : '—'
}

function formatFaceAmount(value: string | null, formatter: Intl.NumberFormat) {
  if (value === null) return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? formatter.format(amount) : '—'
}

function isPendingLapse(policy: Pick<PolicyDirectoryItem, 'sourceStatus'>) {
  return policy.sourceStatus?.trim().toLocaleLowerCase('en-US') === 'pending lapse'
}

function policyHref(
  filters: PolicyDirectoryFilters,
  changes: Partial<PolicyDirectoryFilters> = {},
) {
  const next = { ...filters, ...changes }
  const params = new URLSearchParams({ view: next.view })
  if (next.query) params.set('q', next.query)
  if (next.status) params.set('status', next.status)
  if (next.premiumKnown) params.set('premium', 'known')
  if (next.sort !== 'recent') params.set('sort', next.sort)
  if (next.page > 1) params.set('page', String(next.page))
  return `/agent/policies?${params.toString()}`
}

function PolicyRowSurface({
  linkedPolicyId,
  label,
  children,
}: {
  linkedPolicyId: string | null
  label: string
  children: React.ReactNode
}) {
  return linkedPolicyId
    ? <Link href={`/agent/policies/${linkedPolicyId}`} className="policy-list-row" data-policy-row aria-label={label}>{children}</Link>
    : <div className="policy-list-row" data-policy-row>{children}</div>
}

function sortLabel(sort: PolicyDirectorySort, copy: (pt: string, en: string) => string) {
  if (sort === 'client-asc') return copy('Cliente: A–Z', 'Client: A–Z')
  if (sort === 'client-desc') return copy('Cliente: Z–A', 'Client: Z–A')
  if (sort === 'premium-desc') return copy('Maior prêmio', 'Highest premium')
  if (sort === 'premium-asc') return copy('Menor prêmio', 'Lowest premium')
  return copy('Mais recentes', 'Most recent')
}

export function PoliciesList({
  items,
  total,
  page,
  pageCount,
  summary,
  statusCounts,
  filters,
}: {
  items: PolicyDirectoryItem[]
  total: number
  page: number
  pageCount: number
  summary: PolicyDirectorySummary
  statusCounts: Record<string, number>
  filters: PolicyDirectoryFilters
}) {
  const { copy, language, locale } = useI18n()
  const currency = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const wholeCurrency = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const count = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const statusDate = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' })
  const start = total === 0 ? 0 : (page - 1) * 25 + 1
  const end = Math.min(page * 25, total)
  const hasFilters = Boolean(filters.query || filters.status || filters.premiumKnown || filters.sort !== 'recent')
  const currentHref = policyHref(filters, { view: 'current', page: 1 })
  const historyHref = policyHref(filters, { view: 'history', page: 1 })
  const allStatusCount = Object.entries(statusCounts)
    .filter(([status]) => status !== 'PENDING_LAPSE')
    .reduce((sum, [, value]) => sum + value, 0)

  return (
    <div className="module-content-grid">
      <section className="module-main-surface">
        <nav className="policy-metrics-nav" aria-label={copy('Atalhos da carteira de apólices', 'Policy book shortcuts')}>
          <Link className="policy-metric-card" href={policyHref(filters, { query: '', status: null, premiumKnown: false, sort: 'recent', page: 1 })}>
            <span className="policy-metric-surface">
              <span className="policy-metric-heading"><strong>{copy('Apólices', 'Policies')}</strong></span>
              <span className="policy-metric-value"><strong>{count.format(summary.total)}</strong></span>
              <span className="policy-metric-footer"><small>{copy('Resultado completo do filtro', 'Full filtered result')}</small></span>
            </span>
          </Link>
          <Link className="policy-metric-card" href={policyHref(filters, { query: '', status: 'INFORCE', premiumKnown: false, sort: 'recent', page: 1 })}>
            <span className="policy-metric-surface">
              <span className="policy-metric-heading"><strong>{copy('Em vigor', 'In force')}</strong></span>
              <span className="policy-metric-value"><strong>{count.format(summary.inForce)}</strong></span>
              <span className="policy-metric-footer"><small>{copy('Proteções ativas neste resultado', 'Coverage active in this result')}</small></span>
            </span>
          </Link>
          <Link className="policy-metric-card" href={policyHref(filters, { query: '', status: null, premiumKnown: true, sort: 'premium-desc', page: 1 })}>
            <span className="policy-metric-surface">
              <span className="policy-metric-heading"><strong>{copy('Prêmio registrado', 'Recorded premium')}</strong></span>
              <span className="policy-metric-value"><small>US$</small><strong>{wholeCurrency.format(summary.totalPremium)}</strong></span>
              <span className="policy-metric-footer"><small>{copy('{count} com valor informado', '{count} with an amount', { count: count.format(summary.withPremium) })}</small></span>
            </span>
          </Link>
        </nav>

        <section aria-labelledby="policy-navigation-title" className="policy-command-deck mt-6">
          <header className="policy-command-heading">
            <div>
              <h2 id="policy-navigation-title">{copy('Encontre uma apólice em segundos.', 'Find a policy in seconds.')}</h2>
              <p>{copy('A busca, a ordenação e a paginação são aplicadas à carteira no servidor.', 'Search, sort, and pagination are applied to the book on the server.')}</p>
            </div>
            <p className="policy-result-count" role="status" aria-live="polite">
              <span>{start}–{end}</span>
              <small>{copy('de', 'of')} {count.format(total)}</small>
            </p>
          </header>

          <form action="/agent/policies" method="get" className="policy-command-grid">
            <input type="hidden" name="view" value={filters.view} />
            <label className="policy-command-search" htmlFor="policy-search">
              <span>{copy('Buscar na carteira', 'Search the book')}</span>
              <input
                id="policy-search"
                name="q"
                type="search"
                defaultValue={filters.query}
                placeholder={copy('Nome, número, seguradora ou produto', 'Name, number, carrier, or product')}
              />
            </label>
            <label className="policy-command-sort" htmlFor="policy-status">
              <span>{copy('Status da apólice', 'Policy status')}</span>
              <select id="policy-status" name="status" defaultValue={filters.status ?? ''}>
                <option value="">{copy('Todos', 'All')} ({count.format(allStatusCount)})</option>
                {STATUS_ORDER.filter((status) => (statusCounts[status] ?? 0) > 0).map((status) => (
                  <option key={status} value={status}>
                    {language === 'PT'
                      ? policyStatusLabel[status] ?? status
                      : ({ INFORCE: 'In force', PENDING_LAPSE: 'Pending Lapse', APPROVED: 'Approved', PENDING: 'Pending', LAPSED: 'Lapsed', CANCELLED: 'Canceled' } as Record<string, string>)[status] ?? status}
                    {' '}({count.format(statusCounts[status] ?? 0)})
                  </option>
                ))}
              </select>
            </label>
            <label className="policy-command-sort" htmlFor="policy-premium">
              <span>{copy('Prêmio', 'Premium')}</span>
              <select id="policy-premium" name="premium" defaultValue={filters.premiumKnown ? 'known' : ''}>
                <option value="">{copy('Todos os registros', 'All records')}</option>
                <option value="known">{copy('Prêmio informado', 'Premium provided')}</option>
              </select>
            </label>
            <label className="policy-command-sort" htmlFor="policy-sort">
              <span>{copy('Ordenar carteira', 'Sort book')}</span>
              <select id="policy-sort" name="sort" defaultValue={filters.sort}>
                {(['recent', 'client-asc', 'client-desc', 'premium-desc', 'premium-asc'] as PolicyDirectorySort[]).map((sort) => (
                  <option key={sort} value={sort}>{sortLabel(sort, copy)}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="policy-command-clear">{copy('Aplicar', 'Apply')}</button>
            {hasFilters && <Link className="policy-command-clear" href={policyHref(filters, { query: '', status: null, premiumKnown: false, sort: 'recent', page: 1 })}>{copy('Limpar', 'Clear')}</Link>}
          </form>
        </section>

        {total === 0 ? (
          <div className="mt-6 space-y-4">
            <EmptyState>
              {hasFilters
                ? copy('Nenhuma apólice corresponde aos filtros selecionados.', 'No policies match the selected filters.')
                : copy('Nenhuma apólice ainda. Apólices aparecem quando uma oportunidade chega à emissão ou por importação de histórico autorizada.', 'No policies yet. Policies appear when an opportunity reaches issue or through an authorized historical import.')}
            </EmptyState>
            {hasFilters && <Link href={policyHref(filters, { query: '', status: null, premiumKnown: false, sort: 'recent', page: 1 })}>{copy('Limpar filtros', 'Clear filters')}</Link>}
          </div>
        ) : (
          <>
            <div id="policy-list" className="policy-list-frame mt-6">
              <div className="policy-list-header" aria-hidden="true">
                <span>{copy('Cliente e apólice', 'Client and policy')}</span>
                <span>{copy('Capital segurado e produto', 'Face amount and product')}</span>
                <span>{copy('Prêmio', 'Premium')}</span>
                <span>{copy('Status', 'Status')}</span>
              </div>
              <ul className="policy-list">
                {items.map((policy) => (
                  <li key={policy.stableKey}>
                    <PolicyRowSurface
                      linkedPolicyId={policy.linkedPolicyId}
                      label={copy('Abrir apólice {number} de {client}', 'Open policy {number} for {client}', { number: policy.policyNumber, client: policy.clientName })}
                    >
                      <span className="policy-list-identity">
                        <strong>{policy.clientName}</strong>
                        <small>{policy.policyNumber}</small>
                        {!policy.linkedPolicyId && <small>{copy('Fonte: National Life · sem cadastro local', 'Source: National Life · no local record')}</small>}
                      </span>
                      <span className="policy-list-market"><strong>{formatFaceAmount(policy.faceAmount, currency)}</strong><small>{policy.product}</small></span>
                      <span className="policy-list-premium"><small>{copy('Prêmio', 'Premium')}</small><strong>{formatPremium(policy.premium, currency)}</strong></span>
                      <span className="policy-list-action">
                        <span className="flex flex-col items-end gap-1">
                          {language === 'PT'
                            ? <PolicyStatusPill status={isPendingLapse(policy) ? 'PENDING_LAPSE' : policy.status} />
                            : <span className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-[3px] text-xs font-semibold tracking-wide text-ink-muted">{isPendingLapse(policy) ? 'Pending Lapse' : policy.status}</span>}
                          {policy.statusChangedAt && (isPendingLapse(policy) || policy.status === 'LAPSED' || policy.status === 'CANCELLED') && (
                            <small className="text-[10px] text-ink-muted">{copy('Mudança em {date}', 'Changed on {date}', { date: statusDate.format(new Date(policy.statusChangedAt)) })}</small>
                          )}
                        </span>
                      </span>
                    </PolicyRowSurface>
                  </li>
                ))}
              </ul>
            </div>
            {pageCount > 1 && (
              <nav className="policy-pagination" aria-label={copy('Paginação das apólices', 'Policy pagination')}>
                <p><strong>{start}–{end}</strong><span>{copy('de', 'of')} {count.format(total)}</span></p>
                <div>
                  {page > 1 && <Link href={policyHref(filters, { page: page - 1 })}>{copy('Anterior', 'Previous')}</Link>}
                  <span>{copy('Página {page} de {pages}', 'Page {page} of {pages}', { page, pages: pageCount })}</span>
                  {page < pageCount && <Link href={policyHref(filters, { page: page + 1 })}>{copy('Próxima', 'Next')}</Link>}
                </div>
              </nav>
            )}
          </>
        )}
      </section>
      <ContextPanel eyebrow={copy('Continue por aqui', 'Continue here')} title={copy('Carteira sob controle', 'Your book under control')}>
        <p>{copy('O status mostra a situação atual da apólice. O prêmio preserva o valor e a frequência informados pela seguradora.', 'Status shows the current policy situation. Premium preserves the value and frequency reported by the carrier.')}</p>
        <div className="mt-5 border-t border-white/10 pt-4">
          <Link href={currentHref}>{copy('Carteira atual', 'Current portfolio')}</Link>
          <span className="mx-2">·</span>
          <Link href={historyHref}>{copy('Histórico', 'History')}</Link>
        </div>
      </ContextPanel>
    </div>
  )
}
