// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: mocks.signIn },
    signOut: mocks.signOut,
  },
}))

import { AdminLoginForm } from './AdminLoginForm'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockResolvedValue({ data: { success: true }, error: null })
})

afterEach(cleanup)

async function submitCredentials() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('E-mail corporativo'), 'gestor@keeprone.com')
  await user.type(screen.getByLabelText('Senha'), 'secure-password')
  await user.click(screen.getByRole('button', { name: 'Entrar no painel' }))
}

describe('AdminLoginForm', () => {
  it('renders an explicit, accessible entry for Keepr One managers', () => {
    render(<AdminLoginForm redirectTo="/admin" />)

    expect(screen.getByRole('heading', { name: 'Painel administrativo' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Acesse o backoffice' })).toBeVisible()
    expect(screen.getByLabelText('E-mail corporativo')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Senha')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('link', { name: /Área de usuários/ })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'Esqueci minha senha' })).toHaveAttribute(
      'href',
      '/reset-password?portal=admin',
    )
  })

  it('opens the sanitized administrative destination for an ADMIN account', async () => {
    mocks.signIn.mockResolvedValue({
      data: { user: { id: 'admin-1', role: 'ADMIN' } },
      error: null,
    })
    render(<AdminLoginForm redirectTo="/admin/users?page=2" />)

    await submitCredentials()

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/users?page=2'))
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it.each(['AGENT', 'CLIENT', undefined])(
    'ends the session and refuses a non-administrative role (%s)',
    async (role) => {
      mocks.signIn.mockResolvedValue({
        data: { user: { id: 'user-1', role } },
        error: null,
      })
      render(<AdminLoginForm redirectTo="/admin" />)

      await submitCredentials()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Esta conta não possui acesso administrativo.',
      )
      expect(mocks.signOut).toHaveBeenCalledTimes(1)
      expect(mocks.replace).not.toHaveBeenCalled()
    },
  )

  it('keeps invalid credentials private and does not navigate', async () => {
    mocks.signIn.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    })
    render(<AdminLoginForm redirectTo="/admin" />)

    await submitCredentials()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível entrar. Confira seu e-mail e sua senha.',
    )
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('requires an existing user session to end before showing admin credentials', async () => {
    const user = userEvent.setup()
    render(
      <AdminLoginForm
        redirectTo="/admin"
        initialActiveSession={{
          name: 'Ana Agente',
          email: 'ana@example.com',
          role: 'AGENT',
          portalHref: '/agent',
        }}
      />,
    )

    expect(screen.queryByLabelText('E-mail corporativo')).not.toBeInTheDocument()
    expect(screen.getByText('Ana Agente · ana@example.com')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Voltar ao painel atual' })).toHaveAttribute('href', '/agent')

    await user.click(screen.getByRole('button', { name: 'Sair e usar acesso administrativo' }))

    expect(await screen.findByLabelText('E-mail corporativo')).toBeVisible()
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('exposes the password visibility state without changing the field value', async () => {
    const user = userEvent.setup()
    render(<AdminLoginForm redirectTo="/admin" />)
    const password = screen.getByLabelText('Senha')

    await user.type(password, 'secure-password')
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))

    expect(password).toHaveAttribute('type', 'text')
    expect(password).toHaveValue('secure-password')
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true')
  })
})
