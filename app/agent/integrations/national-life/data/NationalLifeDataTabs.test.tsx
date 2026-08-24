import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NationalLifeDataTabs } from './NationalLifeDataTabs'

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
          },
          {
            id: 'page-1',
            gridKey: 'POLICY_PAYMENT_HISTORY',
            label: null,
            primaryDate: null,
            amounts: {},
          },
        ]}
      />,
    )

    expect(html).toMatch(/Relatórios[\s\S]*?>1<\/span>/)
    expect(html).not.toMatch(/Relatórios[\s\S]*?>2<\/span>/)
  })
})
