// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AdminManagedUser,
  AdminUserDirectoryFilters,
} from '@/lib/admin/user-management'
import { UserDirectory, UserFilters } from './UserDirectory'

const copy = (portuguese: string) => portuguese
const emptyFilters: AdminUserDirectoryFilters = {
  query: '',
  role: null,
  plan: null,
  accessStatus: null,
  subscriptionStatus: null,
  page: 1,
}

afterEach(cleanup)

describe('admin user plan presentation', () => {
  it('offers only the two commercial plans in the plan filter', () => {
    render(<UserFilters filters={emptyFilters} copy={copy} />)

    const planFilter = screen.getByRole('combobox', { name: 'Plano' })
    expect(within(planFilter).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Todos',
      'Plano Agente',
      'Plano Agência',
    ])
  })

  it('presents an agency-linked agent as Plano Agente and keeps the agency relationship separate', () => {
    const row = {
      id: 'user-1',
      name: 'Ana Costa',
      email: 'ana@example.com',
      emailVerified: true,
      role: 'AGENT',
      accessStatus: 'ACTIVE',
      plan: 'AGENT_AGENCY_MEMBER',
      productAccess: { status: 'ACTIVE' },
      subscription: {
        status: 'ACTIVE',
        unitAmountCents: 4_990,
        currency: 'USD',
      },
      agency: { name: 'North Star', membershipRole: 'MEMBER' },
      client: null,
      agent: { parentAgent: null },
      lastSeenAt: null,
      sessionCount: 0,
    } as unknown as AdminManagedUser

    render(
      <UserDirectory
        rows={[row]}
        total={1}
        page={1}
        pageCount={1}
        filters={emptyFilters}
        language="PT"
        copy={copy}
      />,
    )

    expect(screen.getAllByText('Plano Agente').length).toBeGreaterThan(0)
    expect(screen.getAllByText('North Star').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Agente de agência|Agente da agência/)).not.toBeInTheDocument()
  })
})
