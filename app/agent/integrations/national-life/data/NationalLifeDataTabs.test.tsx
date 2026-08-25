// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { NationalLifeDataTabs } from './NationalLifeDataTabs'

afterEach(cleanup)

describe('NationalLifeDataTabs', () => {
  it('does not count a discovery-page artifact as an operational report', () => {
    const html = renderToStaticMarkup(
      <NationalLifeDataTabs
        cases={[]}
        inforce={[]}
        reports={[
          {
            id: 'paid-1',
            gridKey: 'PAID_COMMISSIONS',
            label: 'Paid commissions',
            primaryDate: '2026-08-21',
            amounts: { GrossCommEarned: '$100.00' },
            fetchedAt: '2026-08-25T12:00:00.000Z',
          },
          {
            id: 'page-1',
            gridKey: 'POLICY_PAYMENT_HISTORY',
            label: null,
            primaryDate: null,
            amounts: {},
            fetchedAt: '2026-08-25T12:00:00.000Z',
          },
        ]}
      />,
    )

    expect(html).toMatch(/Relatórios[\s\S]*?>1<\/span>/)
    expect(html).not.toMatch(/Relatórios[\s\S]*?>2<\/span>/)
  })

  it('does not present historical sources outside the current daily plan as fresh reports', () => {
    const view = render(
      <NationalLifeDataTabs
        cases={[]}
        inforce={[]}
        reports={[
          {
            id: 'paid-1',
            gridKey: 'PAID_COMMISSIONS',
            label: 'Paid commissions',
            primaryDate: '2026-08-21',
            amounts: {},
            fetchedAt: '2026-08-25T12:00:00.000Z',
          },
          {
            id: 'projected-old',
            gridKey: 'PROJECTED_COMMISSIONS',
            label: 'Projected commissions',
            primaryDate: '2026-08-17',
            amounts: {},
            fetchedAt: '2026-08-17T12:00:00.000Z',
          },
          {
            id: 'lapse-old',
            gridKey: 'LIFE_PENDING_LAPSE',
            label: 'Pending lapse',
            primaryDate: '2026-08-17',
            amounts: {},
            fetchedAt: '2026-08-17T12:00:00.000Z',
          },
        ]}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: /Relatórios/ }))

    expect(view.getByText('Paid commissions')).toBeTruthy()
    expect(view.queryByText('Projected commissions')).toBeNull()
    expect(view.queryByText('Pending lapse')).toBeNull()
  })
})
