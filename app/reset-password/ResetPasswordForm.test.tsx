// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resetPassword: vi.fn(), requestPasswordReset: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    resetPassword: mocks.resetPassword,
    requestPasswordReset: mocks.requestPasswordReset,
  },
}))

import { ResetPasswordForm } from './ResetPasswordForm'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resetPassword.mockResolvedValue({ data: { status: true }, error: null })
  mocks.requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null })
})

afterEach(cleanup)

describe('ResetPasswordForm', () => {
  it('offers a safe new-link request for an invalid or missing token', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="" tokenError />)

    expect(screen.getByRole('heading', { name: 'Solicite um novo link' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/E-mail da conta/), 'maria@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar novo link' }))

    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: 'maria@example.com',
      redirectTo: '/reset-password?lang=PT',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Se este e-mail estiver cadastrado')
  })

  it('keeps an administrative password recovery inside the admin portal', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="" tokenError portal="admin" />)

    await user.type(screen.getByLabelText(/E-mail da conta/), 'gestora@keeprone.com')
    await user.click(screen.getByRole('button', { name: 'Enviar novo link' }))

    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: 'gestora@keeprone.com',
      redirectTo: '/reset-password?lang=PT&portal=admin',
    }))
    expect(screen.getByRole('link', { name: 'Voltar para o acesso' })).toHaveAttribute(
      'href',
      '/admin/login',
    )
  })

  it('validates matching passwords before calling Better Auth', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="secure-reset-token" tokenError={false} />)

    await user.type(screen.getByLabelText(/Nova senha/), 'password-123')
    await user.type(screen.getByLabelText(/Confirme a senha/), 'different-123')
    await user.click(screen.getByRole('button', { name: 'Atualizar senha' }))

    expect(screen.getByRole('alert')).toHaveTextContent('precisam ser iguais')
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it('resets the password with the email token and confirms session revocation', async () => {
    const user = userEvent.setup()
    render(<ResetPasswordForm token="secure-reset-token" tokenError={false} />)

    await user.type(screen.getByLabelText(/Nova senha/), 'new-password-123')
    await user.type(screen.getByLabelText(/Confirme a senha/), 'new-password-123')
    await user.click(screen.getByRole('button', { name: 'Atualizar senha' }))

    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith({
      newPassword: 'new-password-123',
      token: 'secure-reset-token',
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Senha atualizada')
    expect(screen.getByText(/sessões anteriores foram encerradas/i)).toBeInTheDocument()
  })
})
