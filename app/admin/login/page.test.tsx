// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  getServerI18n: vi.fn(),
  formProps: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`)
  }),
}))

vi.mock('@/lib/i18n/server', () => ({
  getCurrentSession: mocks.getCurrentSession,
  getServerI18n: mocks.getServerI18n,
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('./AdminLoginForm', () => ({
  AdminLoginForm: (props: unknown) => {
    mocks.formProps(props)
    return <div>Formulário administrativo</div>
  },
}))

import AdminLoginPage, { generateMetadata } from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentSession.mockResolvedValue(null)
  mocks.getServerI18n.mockResolvedValue({
    copy: (portuguese: string) => portuguese,
  })
})

afterEach(cleanup)

describe('AdminLoginPage', () => {
  it('keeps the internal sign-in page out of search results', async () => {
    await expect(generateMetadata()).resolves.toMatchObject({
      title: 'Login administrativo',
      robots: { index: false, follow: false },
    })
  })

  it('renders the dedicated form for an anonymous visitor and sanitizes next', async () => {
    render(await AdminLoginPage({
      searchParams: Promise.resolve({ next: 'https://evil.example/admin' }),
    }))

    expect(screen.getByText('Formulário administrativo')).toBeVisible()
    expect(mocks.formProps).toHaveBeenCalledWith({
      redirectTo: '/admin',
      initialActiveSession: null,
    })
  })

  it('redirects an authenticated administrator to the requested admin page', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'admin-1', name: 'Gestora', email: 'gestora@keeprone.com', role: 'ADMIN' },
    })

    await expect(AdminLoginPage({
      searchParams: Promise.resolve({ next: '/admin/users?page=2' }),
    })).rejects.toThrow('REDIRECT:/admin/users?page=2')
  })

  it('asks an authenticated agent to end the user session first', async () => {
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: 'agent-1', name: 'Ana', email: 'ana@example.com', role: 'AGENT' },
    })

    render(await AdminLoginPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.formProps).toHaveBeenCalledWith({
      redirectTo: '/admin',
      initialActiveSession: {
        name: 'Ana',
        email: 'ana@example.com',
        role: 'AGENT',
        portalHref: '/agent',
      },
    })
  })
})
