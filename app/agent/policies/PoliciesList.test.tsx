// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoliciesList } from './PoliciesList'

vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))
vi.mock('gsap', () => ({ default: {} }))
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

afterEach(() => cleanup())

describe('PoliciesList retention filters', () => {
  it('opens a Pending Lapse queue with only the affected clients', () => {
    render(
      <PoliciesList
        initialStatus="PENDING_LAPSE"
        policies={[
          {
            id: 'policy-active',
            policyNumber: 'NL-ACTIVE',
            carrier: 'National Life',
            product: 'IUL',
            faceAmount: null,
            premium: '1200.00',
            status: 'INFORCE',
            sourceStatus: 'Active',
            statusChangedAt: null,
            clientName: 'Cliente Em Dia',
          },
          {
            id: 'policy-risk',
            policyNumber: 'NL-RISK',
            carrier: 'National Life',
            product: 'IUL',
            faceAmount: null,
            premium: '1800.00',
            status: 'INFORCE',
            sourceStatus: 'Pending Lapse',
            statusChangedAt: '2026-08-30T00:00:00.000Z',
            clientName: 'Cliente em Risco',
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /Pending Lapse/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /NL-RISK.*Cliente em Risco/i })).toBeVisible()
    expect(screen.queryByRole('link', { name: /NL-ACTIVE.*Cliente Em Dia/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('Pending Lapse')).toHaveLength(2)
    expect(screen.getByText('Mudança em 30/08/2026')).toBeVisible()
  })
})
