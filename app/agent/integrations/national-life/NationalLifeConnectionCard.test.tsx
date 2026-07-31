// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  bootstrap: vi.fn(),
  cancel: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('./actions', () => ({
  startNationalLifeConnection: mocks.start,
  createNationalLifeViewerBootstrap: mocks.bootstrap,
  cancelNationalLifeConnection: mocks.cancel,
  disconnectNationalLifeConnection: mocks.disconnect,
}))

import { NationalLifeConnectionCard } from './NationalLifeConnectionCard'

function statusResponse(state = 'OPENING_PORTAL') {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        id: 'attempt-1',
        state,
        currentOrigin: null,
        safeErrorCode: null,
        expiresAt: '2026-07-28T12:10:00.000Z',
      }),
      { status: 200 },
    ),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(() => statusResponse()))
  mocks.start.mockResolvedValue({
    ok: true,
    attemptId: 'attempt-1',
    state: 'OPENING_PORTAL',
    expiresAt: '2026-07-28T12:10:00.000Z',
  })
  mocks.cancel.mockResolvedValue({ ok: true })
  mocks.disconnect.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NationalLifeConnectionCard', () => {
  it('offers connection without collecting or claiming to save National Life credentials', async () => {
    render(<NationalLifeConnectionCard summary={null} />)

    expect(screen.getByRole('button', { name: 'Conectar National Life' })).toBeInTheDocument()
    expect(screen.getByText('O Keepr One não armazena sua senha')).toBeInTheDocument()
    expect(screen.queryByLabelText(/usuário|senha/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/salvar conexão/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))
    expect(await screen.findByRole('dialog', { name: 'Entrar na National Life' })).toBeInTheDocument()
  })

  it('shows the reusable session summary and disconnect action', () => {
    render(
      <NationalLifeConnectionCard
        summary={{
          provider: 'NATIONAL_LIFE',
          status: 'CONNECTED',
          lastConnectedAt: '2026-07-28T12:00:00.000Z',
          lastUsedAt: '2026-07-28T12:05:00.000Z',
          carrierExpiresAt: '2026-07-28T20:00:00.000Z',
          illustrationSsoReachable: true,
          illustrationSsoCheckedAt: '2026-07-28T12:05:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('Conectada')).toBeInTheDocument()
    expect(screen.getByText('Última conexão')).toBeInTheDocument()
    expect(screen.getByText('Última verificação')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desconectar' })).toBeInTheDocument()
  })

  it('never offers a session deadline, because the value behind it is a bot cookie', () => {
    render(
      <NationalLifeConnectionCard
        summary={{
          provider: 'NATIONAL_LIFE',
          status: 'CONNECTED',
          lastConnectedAt: '2026-07-28T12:00:00.000Z',
          lastUsedAt: '2026-07-28T12:05:00.000Z',
          carrierExpiresAt: '2026-07-28T20:00:00.000Z',
          illustrationSsoReachable: null,
          illustrationSsoCheckedAt: null,
        }}
      />,
    )

    expect(screen.queryByText('Validade da sessão')).not.toBeInTheDocument()
    // Nothing crossed the SSO jump yet, which is not the same as knowing it is
    // unreachable — the card must not claim either way.
    expect(screen.getByText('Não verificada')).toBeInTheDocument()
  })

  it('says the illustration is out of reach when the last jump hit the login wall', () => {
    render(
      <NationalLifeConnectionCard
        summary={{
          provider: 'NATIONAL_LIFE',
          status: 'CONNECTED',
          lastConnectedAt: '2026-07-28T12:00:00.000Z',
          lastUsedAt: '2026-07-28T12:05:00.000Z',
          carrierExpiresAt: null,
          illustrationSsoReachable: false,
          illustrationSsoCheckedAt: '2026-07-28T12:05:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('Ilustração (Foresight)')).toBeInTheDocument()
    expect(screen.getByText('Requer novo login')).toBeInTheDocument()
  })

  it('closes after authentication, refreshes the summary, and announces success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'attempt-1',
          state: 'AUTHENTICATED',
          currentOrigin: 'https://agent.nationallife.com',
          safeErrorCode: null,
          expiresAt: '2026-07-28T12:10:00.000Z',
        }),
        { status: 200 },
      ),
    )

    render(<NationalLifeConnectionCard summary={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('National Life conectada')
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
