// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./new/actions', () => ({ requestForesightIllustration: vi.fn() }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({
  sendConnectorMessage: vi.fn(),
}))

import { requestForesightIllustration } from './new/actions'
import { NewIllustrationForm } from './NewIllustrationForm'

afterEach(cleanup)

describe('NewIllustrationForm', () => {
  it('collects exactly one source amount for the selected IUL solve basis', async () => {
    const user = userEvent.setup()
    render(<NewIllustrationForm />)

    expect(screen.getByRole('radio', { name: 'Resolver pelo capital segurado' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Capital segurado' })).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Prêmio mensal' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Resolver pelo prêmio mensal' }))

    expect(screen.getByRole('spinbutton', { name: 'Prêmio mensal' })).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Capital segurado' })).toBeNull()
    expect(screen.getByDisplayValue('PREMIUM')).toBeTruthy()
  })

  it('switches to the carrier-specific Term fields without asking for an IUL premium', async () => {
    const user = userEvent.setup()
    render(<NewIllustrationForm />)

    await user.click(screen.getByRole('radio', { name: 'Term Life' }))

    expect(screen.getByText('Emissora do Term')).toBeTruthy()
    expect(screen.getByText('Prazo do Term')).toBeTruthy()
    expect(screen.queryByText('Prêmio mensal')).toBeNull()
    expect(screen.getByDisplayValue('LSW_TERM')).toBeTruthy()
  })

  it('accepts only the first submit while an illustration is being created', () => {
    vi.mocked(requestForesightIllustration).mockReturnValue(new Promise(() => {}))
    const { container } = render(<NewIllustrationForm />)
    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form!)
    fireEvent.submit(form!)

    expect(requestForesightIllustration).toHaveBeenCalledTimes(1)
  })
})
