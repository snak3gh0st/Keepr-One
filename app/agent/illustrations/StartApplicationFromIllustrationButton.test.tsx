// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  start: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/app/agent/cases/[id]/actions', () => ({
  startApplicationFromIllustration: mocks.start,
}))

import { StartApplicationFromIllustrationButton } from './StartApplicationFromIllustrationButton'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.start.mockResolvedValue({ ok: true, caseId: 'case-1', applicationId: 'application-1' })
})

afterEach(cleanup)

describe('StartApplicationFromIllustrationButton', () => {
  it('creates the Application from the selected Illustration and opens its dossier', async () => {
    render(<StartApplicationFromIllustrationButton illustrationId="illustration-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Criar Application no iGO' }))

    await waitFor(() => {
      expect(mocks.start).toHaveBeenCalledWith('illustration-1')
      expect(mocks.push).toHaveBeenCalledWith('/agent/cases/case-1#application')
    })
  })

  it('keeps the user on the Illustration when the official source is not ready', async () => {
    mocks.start.mockResolvedValue({ ok: false, message: 'Aguarde o PDF oficial.' })
    render(<StartApplicationFromIllustrationButton illustrationId="illustration-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Criar Application no iGO' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Aguarde o PDF oficial.')
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
