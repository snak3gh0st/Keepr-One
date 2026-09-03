// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
import { LanguageProvider } from '@/components/i18n/LanguageProvider'
import { ImpersonationBanner } from './ImpersonationBanner'
import { ImpersonationProvider } from './ImpersonationContext'

afterEach(cleanup)

describe('ImpersonationBanner', () => {
  it('keeps the target, read-only boundary and return action visible', () => {
    render(
      <LanguageProvider initialLanguage="PT">
        <ImpersonationProvider value={{
          active: true,
          targetId: 'agent-1',
          targetName: 'Ana Agente',
          targetEmail: 'ana@example.com',
          targetRole: 'AGENT',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        }}>
          <ImpersonationBanner />
        </ImpersonationProvider>
      </LanguageProvider>,
    )

    expect(screen.getByRole('complementary', { name: 'Modo de suporte Keepr One' }))
      .toHaveTextContent('Visualizando como Ana Agente')
    expect(screen.getByText(/somente leitura/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar ao painel Keepr One' })).toBeInTheDocument()
  })

  it('does not render outside a preview session', () => {
    const { container } = render(
      <LanguageProvider initialLanguage="PT">
        <ImpersonationProvider value={{ active: false }}>
          <ImpersonationBanner />
        </ImpersonationProvider>
      </LanguageProvider>,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
