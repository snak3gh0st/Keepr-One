// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoliciesList } from './PoliciesList'

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'PT',
    locale: 'pt-BR',
    copy: (portuguese: string, _english: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
        portuguese,
      ),
  }),
}))

afterEach(cleanup)

const filters = {
  view: 'current' as const,
  query: '',
  status: 'PENDING_LAPSE' as const,
  premiumKnown: false,
  sort: 'recent' as const,
  page: 2,
}

const item = {
  stableKey: 'policy-risk',
  linkedPolicyId: 'policy-risk',
  policyNumber: 'NL-RISK',
  carrier: 'National Life',
  product: 'IUL',
  faceAmount: null,
  premium: '1800.00',
  status: 'INFORCE',
  sourceStatus: 'Pending Lapse',
  statusChangedAt: '2026-08-30T00:00:00.000Z',
  clientName: 'Cliente em Risco',
}

function renderList(overrides: Record<string, unknown> = {}) {
  return render(<PoliciesList
    items={[item]}
    total={51}
    page={2}
    pageCount={3}
    summary={{ total: 51, inForce: 50, withPremium: 50, withoutPremium: 1, totalPremium: 12_000 }}
    statusCounts={{ INFORCE: 51, PENDING_LAPSE: 1 }}
    filters={filters}
    {...overrides}
  />)
}

describe('PoliciesList server directory presentation', () => {
  it('renders only the supplied server page and preserves GET filters in pagination', () => {
    renderList()

    expect(screen.getByRole('link', { name: /NL-RISK.*Cliente em Risco/i })).toBeVisible()
    expect(screen.getAllByText('26–50')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Próxima' })).toHaveAttribute(
      'href',
      '/agent/policies?view=current&status=PENDING_LAPSE&page=3',
    )
    expect(screen.getByRole('combobox', { name: 'Status da apólice' })).toHaveValue('PENDING_LAPSE')
  })

  it('keeps a source-only projection row visible with no policy href', () => {
    renderList({
      items: [{ ...item, linkedPolicyId: null, policyNumber: 'SOURCE-ONLY', clientName: 'Source Client' }],
      total: 1,
      page: 1,
      pageCount: 1,
      filters: { ...filters, page: 1 },
    })

    expect(screen.getByText('SOURCE-ONLY')).toBeVisible()
    expect(screen.queryByRole('link', { name: /SOURCE-ONLY/ })).not.toBeInTheDocument()
    expect(screen.getByText('Fonte: National Life · sem cadastro local')).toBeVisible()
  })

  it('does not retain a client-side copy of the policy book for filtering or slicing', () => {
    const source = readFileSync('app/agent/policies/PoliciesList.tsx', 'utf8')
    expect(source).not.toContain('items.filter(')
    expect(source).not.toContain('items.slice(')
    expect(source).toContain('method="get"')
    expect(source).toContain('key={policy.stableKey}')
  })
})
