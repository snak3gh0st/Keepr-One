// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NationalLifeBookCard } from './NationalLifeBookCard'
import { toPolicyBookSummary } from '@/lib/national-life/policy-book-summary'

const summary = toPolicyBookSummary({
  policyNumber: '774945500',
  policyStatus: 'Active',
  productName: 'LSW Level Term 20-G',
  policyIssueDate: '05/01/2024',
  levelPeriodEndDate: '05/01/2044',
  termConversionDate: '05/01/2039',
  anticipatedAnnualPremium: '880',
  insuredClientName: 'FLAVIA DEABREU MOSCARDI',
  insuredPhoneNumber: '+14075551234',
  insuredAddressLine1: '123 Main St',
  insuredCity: 'Orlando',
  insuredState: 'FL',
  insuredZipcode: '32801',
  ownerClientName: 'FLAVIA DEABREU MOSCARDI',
  ownerEmail: 'flavia@example.com',
  fetchedAt: new Date('2026-09-11T23:57:48.957Z'),
})

// Sem `globals: true` no vitest, a limpeza não é automática: sem isto o segundo
// render soma ao primeiro e uma busca por texto único encontra dois.
afterEach(() => cleanup())

describe('NationalLifeBookCard', () => {
  it('mostra o que a grade da seguradora entregou para esta apólice', () => {
    render(<NationalLifeBookCard summary={summary} />)

    expect(screen.getByText('LSW Level Term 20-G')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('05/01/2024')).toBeInTheDocument()
    expect(screen.getByText(/US\$\s*880,00/)).toBeInTheDocument()
    expect(screen.getByText('123 Main St, Orlando, FL 32801')).toBeInTheDocument()
    expect(screen.getByText('flavia@example.com')).toBeInTheDocument()
    expect(screen.getByText('+14075551234')).toBeInTheDocument()
  })

  it('credita a seguradora e a data, porque nenhum número aqui é nosso', () => {
    render(<NationalLifeBookCard summary={summary} />)

    expect(screen.getByText(/conforme a National Life em/i)).toBeInTheDocument()
  })

  it('não desenha campo que a seguradora não mandou', () => {
    render(<NationalLifeBookCard summary={summary} />)

    // Valor em conta não veio nesta linha: a seção de dinheiro não inventa "—".
    expect(screen.queryByText('Valor em conta')).not.toBeInTheDocument()
  })

  it('não renderiza nada quando não há linha da seguradora', () => {
    const { container } = render(<NationalLifeBookCard summary={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('não renderiza nada quando a linha veio sem conteúdo algum', () => {
    const empty = toPolicyBookSummary({ policyNumber: '1', fetchedAt: new Date('2026-09-01T00:00:00.000Z') })
    const { container } = render(<NationalLifeBookCard summary={empty} />)

    expect(container).toBeEmptyDOMElement()
  })
})
