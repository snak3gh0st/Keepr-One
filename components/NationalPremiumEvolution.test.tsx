// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NationalPremiumEvolution } from './NationalPremiumEvolution'
import { buildPremiumEvolution } from '@/lib/national-life/premium-evolution'

afterEach(cleanup)

describe('NationalPremiumEvolution', () => {
  it('renders source caveat, accessible exact values and URL-backed controls', () => {
    const model = buildPremiumEvolution({ rows: [{ policyNumber: 'private-policy', issueDate: '2026-08-01T00:00:00Z', premium: 1234.56, product: 'FlexLife' }], observedAt: new Date('2026-09-03T12:00:00Z'), verified: true })
    const { container } = render(<NationalPremiumEvolution model={model} language="PT" preservedParams={{ preview: 'agency' }} />)
    expect(screen.getByRole('heading', { name: 'AAP por mês de emissão' })).toBeTruthy()
    expect(screen.getByText(/Não representa pagamentos recebidos/)).toBeTruthy()
    expect(screen.getByLabelText('Período')).toHaveValue('12')
    expect(container.querySelector('form')).toHaveAttribute('method', 'get')
    expect(container.querySelector('input[name="preview"]')).toHaveValue('agency')
    expect(container.textContent).not.toContain('private-policy')
    const table = container.querySelector('table')!
    expect(within(table).getAllByText(/1\.234,56/).length).toBeGreaterThan(0)
    expect(screen.getByRole('img')).toHaveAccessibleName('AAP em dólares por mês de emissão')
  })
  it('does not draw unverified totals as a zero chart', () => {
    const model = buildPremiumEvolution({ rows: [], observedAt: null, verified: false })
    render(<NationalPremiumEvolution model={model} language="EN" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for a complete')
  })
})
