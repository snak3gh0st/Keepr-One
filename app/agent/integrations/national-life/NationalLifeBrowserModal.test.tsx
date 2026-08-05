// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  cancel: vi.fn(),
}))

let resizeObserverCallback: ResizeObserverCallback | undefined
const resizeObserverDisconnect = vi.fn()

class ControlledResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback
  }

  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverDisconnect()
  }
}

function reportViewerAreaSize(width: number, height: number) {
  resizeObserverCallback?.(
    [{ contentRect: { width, height } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )
}

vi.mock('./actions', () => ({
  createNationalLifeViewerBootstrap: mocks.bootstrap,
  cancelNationalLifeConnection: mocks.cancel,
}))

import { NationalLifeBrowserModal } from './NationalLifeBrowserModal'

const attempt = {
  attemptId: 'attempt-1',
  initialState: 'AWAITING_LOGIN',
  expiresAt: '2026-07-28T12:10:00.000Z',
}

function statusResponse(
  state: string,
  currentOrigin: string | null = 'https://auth.nationallife.com',
) {
  return new Response(
    JSON.stringify({
      id: 'attempt-1',
      state,
      currentOrigin,
      safeErrorCode: null,
      expiresAt: '2026-07-28T12:10:00.000Z',
    }),
    { status: 200 },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'))
  mocks.bootstrap.mockResolvedValue({
    ok: true,
    bootstrapUrl: 'https://viewer.keepr.one/bootstrap?ticket=opaque-ticket',
    expiresAt: '2026-07-28T12:01:00.000Z',
  })
  mocks.cancel.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', vi.fn(async () => statusResponse('AWAITING_LOGIN')))
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resizeObserverCallback = undefined
})

describe('NationalLifeBrowserModal', () => {
  it('frames only the broker bootstrap and identifies the real National Life page', async () => {
    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Entrar na National Life' })).toBeInTheDocument()
    expect(screen.getByText('Sessão segura e isolada')).toBeInTheDocument()
    expect(screen.getByText('10:00')).toBeInTheDocument()

    const frame = await screen.findByTitle('Portal oficial da National Life')
    expect(frame).toHaveAttribute(
      'src',
      'https://viewer.keepr.one/bootstrap?ticket=opaque-ticket',
    )
    expect(frame).toHaveAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame).not.toHaveAttribute('allow')
    const stage = screen.getByTestId('national-life-viewer-stage')
    expect(stage).toHaveClass('aspect-[16/10]')
    expect(stage).toHaveClass('max-h-[1000px]')
    expect(stage).toContainElement(frame)
    expect(screen.getByText('https://auth.nationallife.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /voltar|avançar|recarregar/i })).not.toBeInTheDocument()
  })

  it('fits the viewer stage inside a wide, short viewer area', async () => {
    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    const stage = await screen.findByTestId('national-life-viewer-stage')
    act(() => reportViewerAreaSize(1200, 400))

    await waitFor(() => {
      expect(stage.style.width).toBe('640px')
      expect(stage.style.height).toBe('400px')
    })

    const stageWidth = Number.parseFloat(stage.style.width)
    const stageHeight = Number.parseFloat(stage.style.height)
    expect(stageWidth).toBeLessThanOrEqual(1200)
    expect(stageHeight).toBeLessThanOrEqual(400)
    expect(stageWidth / stageHeight).toBeCloseTo(1.6)

    act(() => reportViewerAreaSize(300, 800))

    await waitFor(() => {
      expect(stage.style.width).toBe('300px')
      expect(stage.style.height).toBe('187.5px')
    })
  })

  it('caps the viewer stage at its 1600 by 1000 source size', async () => {
    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    const stage = await screen.findByTestId('national-life-viewer-stage')
    act(() => reportViewerAreaSize(2_000, 2_000))

    await waitFor(() => {
      expect(stage.style.width).toBe('1600px')
      expect(stage.style.height).toBe('1000px')
    })
  })

  it('disconnects the viewer ResizeObserver on unmount', async () => {
    const { unmount } = render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    await screen.findByTestId('national-life-viewer-stage')
    unmount()

    expect(resizeObserverDisconnect).toHaveBeenCalledTimes(1)
  })

  it('keeps the official viewer open while MFA is required', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(statusResponse('AWAITING_MFA'))

    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    expect(await screen.findByText('Confirme a verificação no portal')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancels explicitly and leaves an explainable reconnect path to the card', async () => {
    const onClosed = vi.fn()
    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={onClosed}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar conexão' }))

    await waitFor(() => expect(onClosed).toHaveBeenCalledWith('Conexão cancelada. Você pode tentar novamente.'))
    expect(mocks.cancel).toHaveBeenCalledWith('attempt-1')
  })

  it('sends same-origin keepalive cancellation on unmount and sign-out', () => {
    const { unmount } = render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={vi.fn()}
      />,
    )

    window.dispatchEvent(new Event('keepr-one:sign-out'))
    unmount()

    expect(fetch).toHaveBeenCalledWith(
      '/api/agent/integrations/national-life/attempt/attempt-1/cancel',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
      }),
    )
  })

  it('closes the viewer on terminal error and explains that reconnect remains available', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(statusResponse('EXPIRED'))
    const onClosed = vi.fn()

    render(
      <NationalLifeBrowserModal
        attempt={attempt}
        onAuthenticated={vi.fn()}
        onClosed={onClosed}
      />,
    )

    await waitFor(() =>
      expect(onClosed).toHaveBeenCalledWith(
        'Your secure session timed out. Connect again to continue.',
      ),
    )
  })
})
