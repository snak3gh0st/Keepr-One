// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveNationalLifeCredentialAction: vi.fn(),
  revokeNationalLifeCredentialAction: vi.fn(),
}))

vi.mock('./credential-actions', () => mocks)

import { KBotCredentialSettings } from './KBotCredentialSettings'
import { INITIAL_SETTINGS_ACTION_STATE } from './state'

const notConfigured = {
  configured: false,
  autoLoginEnabled: false,
  status: 'NOT_CONFIGURED' as const,
  maskedUsername: null,
  consentedAt: null,
  lastSucceededAt: null,
  lastRejectedAt: null,
}

beforeEach(() => {
  mocks.saveNationalLifeCredentialAction.mockResolvedValue(INITIAL_SETTINGS_ACTION_STATE)
  mocks.revokeNationalLifeCredentialAction.mockResolvedValue(INITIAL_SETTINGS_ACTION_STATE)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('KBotCredentialSettings', () => {
  it('retains manual-login guidance while the broker is disabled', () => {
    render(
      <KBotCredentialSettings
        connectorEnabled
        credentialBrokerEnabled={false}
        summary={notConfigured}
      />,
    )

    expect(screen.getByText(/não guarda nem envia sua senha da National Life/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Gerenciar K-Bot e National Life' })).toHaveAttribute(
      'href',
      '/agent/integrations/national-life',
    )
    expect(screen.queryByLabelText(/Senha da National Life/)).toBeNull()
  })

  it('requires explicit unchecked consent and correctly classified password fields', () => {
    render(
      <KBotCredentialSettings
        connectorEnabled
        credentialBrokerEnabled
        summary={notConfigured}
      />,
    )

    expect(screen.getByLabelText(/Usuário da National Life/)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/^Senha da National Life/)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/Senha atual do Keepr One/)).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
    expect(screen.getByRole('checkbox', { name: /autorizo o Keepr One/i })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Proteger credencial' })).toBeEnabled()
  })

  it('shows safe metadata and exposes replace/revoke but no reveal or copy path', async () => {
    const user = userEvent.setup()
    const summary = {
      configured: true,
      autoLoginEnabled: true,
      status: 'READY' as const,
      maskedUsername: 'ag***23',
      consentedAt: '2026-09-01T18:00:00.000Z',
      lastSucceededAt: '2026-09-01T19:00:00.000Z',
      lastRejectedAt: null,
      encryptedPayload: 'vault:v7:must-never-render',
    }
    const { container } = render(
      <KBotCredentialSettings
        connectorEnabled
        credentialBrokerEnabled
        summary={summary}
      />,
    )

    expect(screen.getByText('ag***23')).toBeVisible()
    expect(screen.getByText('Pronta')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Substituir credencial' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remover credencial' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /revelar|copiar/i })).toBeNull()
    expect(container.textContent).not.toContain('vault:v7:must-never-render')
    expect(screen.queryByLabelText(/Usuário da National Life/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Substituir credencial' }))
    expect(screen.getByLabelText(/Usuário da National Life/)).toBeVisible()
  })

  it('explains that a rejected password stopped after one attempt', () => {
    render(
      <KBotCredentialSettings
        connectorEnabled
        credentialBrokerEnabled
        summary={{
          ...notConfigured,
          configured: true,
          status: 'REJECTED',
          maskedUsername: 'ag***23',
          lastRejectedAt: '2026-09-01T20:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByText(/tentou uma vez e parou/i)).toBeVisible()
    expect(screen.getByText(/substitua a credencial/i)).toBeVisible()
  })
})
