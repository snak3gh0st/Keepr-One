// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  request: vi.fn(),
  send: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('./actions', () => ({ requestIllustrationPdf: mocks.request }))
vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({
  sendConnectorMessage: mocks.send,
}))

import { IllustrationPdfButton } from './IllustrationPdfButton'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IllustrationPdfButton', () => {
  it('sends an unclaimed request to reconnect K-Bot instead of issuing another illustration command', () => {
    render(
      <IllustrationPdfButton
        illustrationId="ill_1"
        status={'WAITING_FOR_KBOT' as never}
      />,
    )

    expect(screen.getByRole('link', { name: 'Conectar K-Bot para continuar' })).toHaveAttribute(
      'href',
      '/agent/integrations/national-life',
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('shows the real Foresight step reported by K-Bot in plain language', async () => {
    mocks.send.mockResolvedValue({
      ok: true,
      command: { status: 'RUNNING', phase: 'GENERATING_PDF' },
    })

    render(
      <IllustrationPdfButton
        illustrationId="ill_1"
        extensionId="abcdefghijklmnopabcdefghijklmnop"
        status="WORKING"
        disabled
      />,
    )

    expect(await screen.findByText('K-Bot está criando o PDF oficial…')).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Etapas da ilustração pelo K-Bot' })).toBeTruthy()
    expect(screen.getByText('Salvar e criar PDF').closest('li')).toHaveAttribute('aria-current', 'step')
  })
})
