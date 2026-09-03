// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../create-actions', () => ({
  createManagedUserAction: vi.fn(async () => ({ status: 'idle', message: '' })),
}))

import { CreateManagedUserForm } from './CreateManagedUserForm'

afterEach(cleanup)

describe('CreateManagedUserForm', () => {
  it('keeps Today mandatory and defaults first access to a 30-day trial with email delivery', () => {
    render(<CreateManagedUserForm />)

    expect(screen.getByRole('radio', { name: /Plano Agente/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Plano Agência/i })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Liberar teste/i })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: /Dias de teste/i })).toHaveValue(30)
    expect(screen.getByRole('checkbox', { name: /Hoje/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Hoje/i })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /Enviar e-mail para definir senha/i })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /^Agência/i })).toBeNull()
  })

  it('reveals agency fields and removes the trial duration when payment is required', async () => {
    const user = userEvent.setup()
    render(<CreateManagedUserForm />)

    await user.click(screen.getByRole('radio', { name: /Plano Agência/i }))
    expect(screen.getByRole('textbox', { name: /Nome da agência/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^Agência/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Equipe/i })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: /Exigir pagamento/i }))
    expect(screen.queryByRole('spinbutton', { name: /Dias de teste/i })).toBeNull()
    expect(screen.getByText('Pagamento obrigatório')).toBeInTheDocument()
  })
})
