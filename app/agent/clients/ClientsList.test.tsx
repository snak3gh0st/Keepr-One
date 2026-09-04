// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientsList } from './ClientsList'

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    copy: (portuguese: string, _english: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((message, [key, value]) => message.replaceAll(`{${key}}`, String(value)), portuguese),
  }),
}))

afterEach(cleanup)

describe('ClientsList server directory presentation', () => {
  it('renders the current 25-row page and retains filters in the next GET link', () => {
    render(<ClientsList
      items={[{ id: 'client-26', name: 'Ana 26', email: null, agentId: 'agent-1', agentName: 'Ana Owner' }]}
      total={51}
      page={2}
      pageCount={3}
      summary={{ total: 51, withEmail: 40, withoutEmail: 11, assignedAgents: 1 }}
      filters={{ query: 'Ana', ownerId: 'agent-1', contactMissing: true, sort: 'name-desc', page: 2 }}
      owners={[{ id: 'agent-1', name: 'Ana Owner' }]}
    />)

    expect(screen.getByRole('link', { name: 'Ana 26' })).toHaveAttribute('href', '/agent/clients/client-26')
    expect(screen.getByText('26–50')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Próxima' })).toHaveAttribute(
      'href',
      '/agent/clients?q=Ana&owner=agent-1&contact=missing&sort=name-desc&page=3',
    )
  })

  it('does not filter or slice a full client array in the browser', () => {
    const source = readFileSync('app/agent/clients/ClientsList.tsx', 'utf8')
    expect(source).not.toContain('items.filter(')
    expect(source).not.toContain('items.slice(')
    expect(source).toContain('method="get"')
  })
})
