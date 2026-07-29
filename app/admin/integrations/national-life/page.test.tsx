// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listHealth: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/national-life/interactive-connection-service', () => ({
  listAgentSessionHealthForAdmin: mocks.listHealth,
}))
vi.mock('@/components/Shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {description}
    </header>
  ),
}))

import NationalLifeAdminPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { name: 'Admin Keepr' } })
  mocks.listHealth.mockResolvedValue([
    {
      agentId: 'agent-1',
      agentName: 'Ana Costa',
      status: 'CONNECTED',
      lastConnectedAt: new Date('2026-07-28T12:00:00.000Z'),
      lastUsedAt: new Date('2026-07-28T12:05:00.000Z'),
      carrierExpiresAt: new Date('2026-07-28T20:00:00.000Z'),
    },
  ])
})

describe('National Life admin health page', () => {
  it('shows status-only agent health without viewer or impersonation access', async () => {
    render(await NationalLifeAdminPage())

    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(screen.getByText('Ana Costa')).toBeInTheDocument()
    expect(screen.getByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText('Última conexão')).toBeInTheDocument()
    expect(screen.getByText('Último uso')).toBeInTheDocument()
    expect(screen.getByText('Expira em')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conectar|desconectar/i })).not.toBeInTheDocument()
    expect(screen.queryByTitle(/portal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/viewer|exportar contexto|impersonar/i)).not.toBeInTheDocument()
  })
})
