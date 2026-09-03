// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listHealth: vi.fn(),
  language: 'PT' as 'PT' | 'EN',
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/national-life/interactive-connection-service', () => ({
  listAgentSessionHealthForAdmin: mocks.listHealth,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: vi.fn(async () => ({
    language: mocks.language,
    copy: (portuguese: string, english: string) =>
      mocks.language === 'PT' ? portuguese : english,
  })),
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
  mocks.language = 'PT'
  mocks.requireRole.mockResolvedValue({ user: { name: 'Admin Keepr' } })
  mocks.listHealth.mockResolvedValue([
    {
      agentId: 'agent-1',
      agentName: 'Ana Costa',
      status: 'CONNECTED',
      lastConnectedAt: new Date('2026-07-28T12:00:00.000Z'),
      lastUsedAt: new Date('2026-07-28T12:05:00.000Z'),
      carrierExpiresAt: new Date('2026-07-28T20:00:00.000Z'),
      illustrationSsoReachable: false,
      illustrationSsoCheckedAt: new Date('2026-07-28T12:05:00.000Z'),
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
    expect(screen.getByText('Última verificação')).toBeInTheDocument()
    // O prazo saiu: era o cookie de bot da Cloudflare. No lugar, o que decide
    // se a ilustração sai — e o admin precisa disso para triar.
    expect(screen.queryByText('Expira em')).not.toBeInTheDocument()
    expect(screen.getByText('Ilustração')).toBeInTheDocument()
    expect(screen.getByText('Requer novo login')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conectar|desconectar/i })).not.toBeInTheDocument()
    expect(screen.queryByTitle(/portal/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/viewer|exportar contexto|impersonar/i)).not.toBeInTheDocument()
  })

  it('renders operational status and dates in English when EN is selected', async () => {
    mocks.language = 'EN'

    render(await NationalLifeAdminPage())

    expect(screen.getByRole('heading', { name: 'National Life integration' })).toBeVisible()
    expect(screen.getByText('Connected')).toBeVisible()
    expect(screen.getByText('Last connection')).toBeVisible()
    expect(screen.getByText('New sign-in required')).toBeVisible()
  })
})
