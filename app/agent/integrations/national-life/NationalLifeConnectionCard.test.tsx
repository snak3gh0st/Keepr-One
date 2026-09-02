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
vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
      en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
  }),
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
  it('offers connection without collecting credentials and explains the optional protected setting', async () => {
    render(<NationalLifeConnectionCard summary={null} />)

    expect(screen.getByRole('button', { name: 'Connect National Life' })).toBeInTheDocument()
    expect(screen.getByText('Protected K-Bot sign-in is always opt-in')).toBeInTheDocument()
    expect(screen.queryByLabelText(/username|password/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/save connection/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))
    expect(await screen.findByRole('dialog', { name: 'Sign in to National Life' })).toBeInTheDocument()
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

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Last connected')).toBeInTheDocument()
    expect(screen.getByText('Last checked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
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

    expect(screen.queryByText('Session expires')).not.toBeInTheDocument()
    // Nothing crossed the SSO jump yet, which is not the same as knowing it is
    // unreachable — the card must not claim either way.
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
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

    expect(screen.getByText('Illustrations (Foresight)')).toBeInTheDocument()
    expect(screen.getByText('Sign in again')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect National Life' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('National Life connected')
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
