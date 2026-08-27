// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./new/actions', () => ({ requestForesightIllustration: vi.fn() }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({
  sendConnectorMessage: vi.fn(),
}))

import { NewIllustrationForm } from './NewIllustrationForm'

describe('NewIllustrationForm', () => {
  it('switches to the carrier-specific Term fields without asking for an IUL premium', async () => {
    const user = userEvent.setup()
    render(<NewIllustrationForm />)

    await user.click(screen.getByRole('radio', { name: 'Term Life' }))

    expect(screen.getByText('Emissora do Term')).toBeTruthy()
    expect(screen.getByText('Prazo do Term')).toBeTruthy()
    expect(screen.queryByText('Prêmio mensal')).toBeNull()
    expect(screen.getByDisplayValue('LSW_TERM')).toBeTruthy()
  })
})
