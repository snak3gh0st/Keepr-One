// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  userGroupBy: vi.fn(),
  userCount: vi.fn(),
  recentSessions: vi.fn(),
  recentAudit: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { groupBy: mocks.userGroupBy, count: mocks.userCount },
    session: { findMany: mocks.recentSessions },
    auditLog: { findMany: mocks.recentAudit },
  },
}))
vi.mock('@/lib/admin/user-management', () => ({
  buildAdminUserWhere: vi.fn((filters: unknown) => filters),
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: vi.fn(async () => ({
    language: 'PT',
    copy: (portuguese: string) => portuguese,
  })),
}))
vi.mock('@/components/Shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({
    title,
    eyebrow,
    description,
    children,
  }: {
    title: string
    eyebrow?: string
    description?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <header>
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </header>
  ),
}))
vi.mock('@/components/ModuleSummary', () => ({
  ModuleSummary: ({
    label,
    items,
  }: {
    label: string
    items: Array<{ label: string; value: React.ReactNode; detail: string }>
  }) => (
    <section aria-label={label}>
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <p>{item.detail}</p>
        </div>
      ))}
    </section>
  ),
}))

import AdminDashboard from './page'

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { name: 'Gestora Keepr' } })
  mocks.userGroupBy.mockResolvedValue([
    { role: 'AGENT', banned: false, emailVerified: true, _count: { _all: 28 } },
    { role: 'AGENT', banned: true, emailVerified: true, _count: { _all: 1 } },
    { role: 'CLIENT', banned: false, emailVerified: false, _count: { _all: 10 } },
    { role: 'ADMIN', banned: false, emailVerified: true, _count: { _all: 2 } },
  ])
  ;[16, 3, 2, 1, 20, 5, 2, 1, 3].forEach((count) => {
    mocks.userCount.mockResolvedValueOnce(count)
  })
  mocks.recentSessions.mockResolvedValue([
    {
      id: 'session-1',
      createdAt: new Date('2026-09-01T14:00:00.000Z'),
      user: {
        id: 'user-1',
        name: 'Ana Costa',
        email: 'ana@example.com',
        role: 'AGENT',
        banned: false,
      },
    },
  ])
  mocks.recentAudit.mockResolvedValue([
    {
      id: 'audit-1',
      action: 'ADMIN_USER_SUSPENDED',
      entity: 'User',
      entityId: 'user-1',
      before: { accessStatus: 'ACTIVE' },
      after: { accessStatus: 'SUSPENDED' },
      createdAt: new Date('2026-09-01T15:00:00.000Z'),
      user: { name: 'Gestora Keepr' },
    },
  ])
})

describe('Keepr One admin dashboard', () => {
  it('presents platform management data instead of insurance-production metrics', async () => {
    render(await AdminDashboard())

    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(screen.getByRole('heading', { name: 'Backoffice Keepr One' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Resumo da plataforma' })).toHaveTextContent('Usuários41')
    expect(screen.getByRole('region', { name: 'Resumo da plataforma' })).toHaveTextContent('Planos Agente16')
    expect(screen.getByRole('region', { name: 'Resumo da plataforma' })).toHaveTextContent('Planos Agência3')
    expect(screen.getByRole('region', { name: 'Resumo da plataforma' })).toHaveTextContent('Assinaturas ativas20')
    expect(screen.getByRole('link', { name: /Plano Agente/ })).toHaveAttribute('href', '/admin/users?plan=AGENT')
    expect(screen.getByRole('link', { name: /Plano Agência/ })).toHaveAttribute('href', '/admin/users?plan=AGENCY')
    expect(screen.queryByText('Agente individual')).not.toBeInTheDocument()
    expect(screen.queryByText('Agente vinculado à agência')).not.toBeInTheDocument()
    expect(screen.getByText('E-mails não verificados')).toBeVisible()
    expect(screen.queryByText('Integrações com atenção')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver auditoria' })).not.toBeInTheDocument()
    expect(screen.queryByText(/comissão paga|prêmio sob gestão/i)).not.toBeInTheDocument()
  })

  it('shows recent user access and the latest Keepr One administrative action', async () => {
    render(await AdminDashboard())

    expect(screen.getByRole('heading', { name: 'Acessos recentes' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Ana Costa' })).toHaveAttribute('href', '/admin/users/user-1')
    expect(screen.getByRole('heading', { name: 'Atividade administrativa' })).toBeVisible()
    expect(screen.getByText('Conta suspensa')).toBeVisible()
    expect(screen.getByText(/Gestora Keepr · Acesso: ACTIVE → SUSPENDED/)).toBeVisible()
  })
})
