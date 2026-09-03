// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NationalPolicyQueueTable } from './NationalPolicyQueueTable'

describe('NationalPolicyQueueTable', () => {
  it('shows the already-filtered carrier rows and a way back to the full book', () => {
    render(<NationalPolicyQueueTable language="PT" queue="WAITING_AGENT" rows={[{
      policyNo: 'NL-123', insuredName: 'Cliente Teste', product: 'IUL', carrierStatus: 'Issued',
      deliveryStatus: 'eDelivery with Agent', submitDate: null,
    }]} />)
    expect(screen.getByRole('heading', { name: 'Aguardando agente · 1' })).toBeVisible()
    expect(screen.getByText('NL-123')).toBeVisible()
    expect(screen.getByText('Cliente Teste')).toBeVisible()
    expect(screen.getByRole('link', { name: /Ver carteira completa/ })).toHaveAttribute('href', '/agent/policies')
  })
})
