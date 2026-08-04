// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

import { NationalLifeLocalConnectorCard } from './NationalLifeLocalConnectorCard'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const storeUrl = `https://chromewebstore.google.com/detail/keeproneconnect/${extensionId}`
const baseUrl = 'https://app.keeprone.com'

type RuntimeCallback = (response?: Record<string, unknown>) => void

function installChromeMock(
  handler: (message: { type: string }, callback: RuntimeCallback) => void,
) {
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: {
      runtime: {
        sendMessage: (_id: string, message: { type: string }, callback: RuntimeCallback) =>
          handler(message, callback),
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/agent/integrations/national-life')
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'chrome')
})

describe('NationalLifeLocalConnectorCard', () => {
  it('opens the official store when the connector is absent', async () => {
    installChromeMock((_message, callback) => callback())
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(
      <NationalLifeLocalConnectorCard extensionId={extensionId} storeUrl={storeUrl} baseUrl={baseUrl} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))

    expect(clicked).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Abrindo a instalação segura')
  })

  it('auto-pairs after installation without exposing the pairing code', async () => {
    window.history.replaceState({}, '', '/agent/integrations/national-life?connector=installed')
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: 'NL-super-secret-pairing-code' }), { status: 201 }),
    )
    const messages: string[] = []
    installChromeMock((message, callback) => {
      messages.push(message.type)
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'COMPLETED' },
        })
        return
      }
      callback({ ok: true, deviceId: 'device-1' })
    })

    render(
      <NationalLifeLocalConnectorCard extensionId={extensionId} storeUrl={storeUrl} baseUrl={baseUrl} />,
    )

    await waitFor(() =>
      expect(messages).toEqual(
        expect.arrayContaining(['PAIR_CONNECTOR', 'START_NATIONAL_LIFE_SYNC', 'GET_CONNECTOR_STATUS']),
      ),
    )
    expect(document.body).not.toHaveTextContent('NL-super-secret-pairing-code')
    expect(window.location.search).toBe('')
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('starts sync and waits for completion via connector status', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: 'COMPLETED' },
        })
        return
      }
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard extensionId={extensionId} storeUrl={storeUrl} baseUrl={baseUrl} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))

    expect(fetch).not.toHaveBeenCalled()
    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('concluída'),
      { timeout: 3_000 },
    )
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('surfaces AUTH_REQUIRED while the agent logs into National Life', async () => {
    let syncStatus = 'NAVIGATING'
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({
          ok: true,
          device: { status: 'READY', deviceId: 'device-1' },
          sync: { status: syncStatus },
        })
        return
      }
      syncStatus = 'AUTH_REQUIRED'
      callback({ ok: true })
    })

    render(
      <NationalLifeLocalConnectorCard extensionId={extensionId} storeUrl={storeUrl} baseUrl={baseUrl} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))

    await waitFor(
      () => expect(screen.getByRole('status')).toHaveTextContent('portal oficial'),
      { timeout: 3_000 },
    )
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled()
  })

  it('shows a recoverable friendly error', async () => {
    installChromeMock((message, callback) => {
      if (message.type === 'GET_CONNECTOR_STATUS') {
        callback({ ok: true, device: { status: 'READY' }, sync: { status: 'IDLE' } })
        return
      }
      callback({ ok: false, error: 'PORTAL_FAILED' })
    })

    render(
      <NationalLifeLocalConnectorCard extensionId={extensionId} storeUrl={storeUrl} baseUrl={baseUrl} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Conectar National Life' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Tente novamente')
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled()
  })
})
