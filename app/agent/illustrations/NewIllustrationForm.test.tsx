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
  it('collects exactly one source amount for the selected IUL strategy', async () => {
    const user = userEvent.setup()
    render(<NewIllustrationForm />)

    expect(screen.getByRole('radio', { name: 'Máximo Cash Value' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: 'Aporte mensal' })).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Capital segurado' })).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Foco em proteção' }))

    expect(screen.getByRole('spinbutton', { name: 'Capital segurado' })).toBeTruthy()
    expect(screen.queryByRole('spinbutton', { name: 'Aporte mensal' })).toBeNull()
    expect(screen.getByDisplayValue('Protection_Focus')).toBeTruthy()
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
