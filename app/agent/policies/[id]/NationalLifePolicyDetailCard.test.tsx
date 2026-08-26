// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NationalLifePolicyDetailCard } from './NationalLifePolicyDetailCard'

describe('NationalLifePolicyDetailCard', () => {
  it('shows carrier values and their freshness without the obsolete denial', () => {
    render(<NationalLifePolicyDetailCard detail={{
      totalFaceAmount: '133000.00',
      netDeathBenefit: '133000.00',
      plannedPeriodicPayment: '200.00',
      paymentFrequency: 'Monthly',
      anticipatedAnnualPremium: '2400.00',
      observedAt: '2026-08-26T15:30:43.000Z',
    }} />)

    expect(screen.getAllByText('$133,000.00')).toHaveLength(2)
    expect(screen.getByText(/\$200\.00 · Monthly/)).toBeInTheDocument()
    expect(screen.getByText('$2,400.00')).toBeInTheDocument()
    expect(screen.getByText(/Fonte: detalhe da apólice na National Life/)).toBeInTheDocument()
    expect(screen.queryByText(/não vêm do portal/)).not.toBeInTheDocument()
  })

  it('says the detail is not synced yet without claiming the carrier lacks it', () => {
    render(<NationalLifePolicyDetailCard detail={null} />)

    expect(screen.getByText(/disponibiliza cobertura e pagamentos/)).toBeInTheDocument()
    expect(screen.getByText(/ainda não foram sincronizados/)).toBeInTheDocument()
    expect(screen.queryByText(/não fornece/)).not.toBeInTheDocument()
  })
})
